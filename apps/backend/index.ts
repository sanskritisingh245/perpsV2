import express, { response, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { SignupSchema } from "./zod/auth";
import { COLLATERAL, OrderType, prisma, Prisma } from "@repo/db";
import  jwt  from "jsonwebtoken";
import { authMiddleware } from "./authMiddleware";
import { balanceSchema } from "./zod/balance";
import { OrderSchema } from "./zod/order";
import { createClient } from "redis";



const JWT_SECRET=process.env.JWT_SECRET||"";
const ADMIN_SECRET=process.env.ADMIN_SECRET || "";


const client=createClient();//publish message
client.connect();



const app = express();
app.use(express.json());

// In-memory set of valid market ids, used to reject orders on unknown markets
// without a DB round-trip per order. Warmed before the server starts, refreshed
// every 10s, and updated eagerly on market creation so new markets aren't stale.
let marketIds = new Set<string>();
async function refreshMarkets() {
    try {
        const data = await prisma.market.findMany({ select: { id: true } });
        marketIds = new Set(data.map((m) => m.id));
    } catch (err) {
        console.error("market cache refresh failed", err);
    }
}
await refreshMarkets();
setInterval(refreshMarkets, 10_000);

app.post("/api/signup", async (req: Request, res: Response) =>{
    const {success, data}= SignupSchema.safeParse(req.body);
    if (!success) {
      return res.status(411).json({
        success: false,
        error: "INVALID_DATA",
      });
    }
    if(!data.username || !data.password){
        return res.status(411).json({
            success:false,
            error:"DATA_NOT_PROVIDED"
        })
    }

    const user=await prisma.user.findUnique({
        where:{username:data.username}
    })
    if(user){
        return res.status(400).json({
            success:false,
            error:"USERNAME_ALREADY_EXSIST"
        })
    }
    const hashPassowrd=await bcrypt.hash(data.password,10)
    const response = await prisma.user.create({
        data:{
            username:data.username,
            password: hashPassowrd
        }
    })

    res.json({
        success:true,
        id:response.id
    })
})

app.post("/api/signin", async (req:Request, res:Response)=>{
    const {success, data}= SignupSchema.safeParse(req.body);
    if (!success) {
      return res.status(403).json({
        success: false,
        error: "INVALID_DATA",
      });
    }
    if(!data.username || !data.password){
        return res.status(411).json({
            success:false,
            error:"DATA_NOT_PROVIDED"
        })
    }

    const user=await prisma.user.findUnique({
        where:{username:data.username}
    })
    if(!user){
        return res.status(403).json({
            success:false,
            error:"INCORRECT_CREDENTIALS"
        })
    }
    const password= await bcrypt.compare(data.password, user.password)
        if(!password){
            return res.status(400).json({
                success:false,
                error:"INCORRECT_PASSWORD"
            })
        }
        
    const token= jwt.sign({
        id:user.id,
        username:user.username
    },JWT_SECRET)
    //console.log("token", token )
    return res.status(200).json({
        success:true,
        data:token,
        msg:"SUCCESSFULLY_SIGNEDIN"
    })

})

app.post("/api/admin/market", async (req:Request, res:Response) => {
    if (req.headers.authorization !== ADMIN_SECRET){
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    const market = await prisma.market.create({ data: { slug: req.body.slug, imageUrl: req.body.imageUrl } });
    marketIds.add(market.id); // keep the order-validation cache fresh for brand-new markets
    return res.json({ success: true, data: market });
    
 
});


app.post ("/api/on-ramp",authMiddleware, async(req:Request, res:Response)=>{
    const userId=req.id 
    const {success, data}= balanceSchema.safeParse(req.body);
    if(!success){
       return res.status(403).json({
        success: false,
        error: "INVALID_DATA",
      }); 
    }

    const balance= await prisma.balance.upsert({
        where:{
            userId_asset:{
                userId:userId,
                asset:COLLATERAL
            }
        },
        update:{
            available:{
                increment:data.amount
            },
        },
        create:{
            userId,
            asset:COLLATERAL,
            available:data.amount,
            locked:"0"
        },      
    });
    return res.status(200).json({
        success:true,
        msg:"balance successfully added"
    })

})

app.get("/api/balance", authMiddleware, async(req:Request, res:Response)=>{
    const userId=req.id;

    const balance= await prisma.balance.findUnique({
        where:{
            userId_asset:{
                userId:userId,
                asset:COLLATERAL
            }
        }
    })

    if(!balance){
        return res.status(404).json({
            success:false,
            error:"BALANCE_NOT_FOUND"
        })
    }

    return res.status(200).json({
        success:true,
        data:balance
    })
})

app.post("/api/order", authMiddleware , async(req:Request, res:Response)=>{
    const userId=req.id;

    const {success, data} = OrderSchema.safeParse(req.body);
    if(!success){
       return res.status(403).json({
        success: false,
        error: "INVALID_DATA",
      });  
    }
    // Reject unknown markets using the in-memory cache (no per-order DB hit).
    if (!marketIds.has(data.market)) {
        return res.status(400).json({ success: false, error: "INVALID_MARKET" });
    }
    

    

    const orderQty = new Prisma.Decimal(data.qty);
    const orderDir = data.side === "BUY" ? "LONG" : "SHORT";

    let order;
    try{
        order = await prisma.$transaction(async(tx)=>{
            // Only the exposure-increasing portion of an order needs fresh margin.
            // An order opposite to an open position closes/reduces it first (that
            // margin is released at settlement), so we lock margin only for any
            // quantity beyond the current position size. A pure close locks 0.
            const position = await tx.position.findUnique({
                where:{ userId_marketId:{ userId, marketId:data.market } },
            });
            let openingQty = orderQty;
            if(position && position.side !== orderDir){
                const posQty = new Prisma.Decimal(position.qty);
                openingQty = orderQty.greaterThan(posQty) ? orderQty.minus(posQty) : new Prisma.Decimal(0);
            }
            const requiredMargin = new Prisma.Decimal(data.price).mul(openingQty).div(data.leverage);

            const locked = await tx.balance.updateMany({
                where:{
                    userId,
                    asset:COLLATERAL,
                    available:{
                        gte: requiredMargin
                    }
                },data:{
                    available: {
                        decrement : requiredMargin
                    },
                    locked: {
                        increment : requiredMargin
                    }
                },
            });
            if(locked.count === 0) throw new Error("NOT_ENOUGH_BALANCE");

            return tx.order.create({
                data:{
                    userId,
                    marketId:data.market,
                    orderType:data.OrderType,
                    side:data.side,
                    price:data.price,
                    qty:data.qty,
                    initialMargin: requiredMargin.toString(),
                    filledQty: "0",
                    status: "OPEN"
                },
            });
        });
    } catch (err: any) {
        if (err.message === "NOT_ENOUGH_BALANCE") {
            return res.status(400).json({ success: false, error: "NOT_ENOUGH_BALANCE" });
        }
        return res.status(500).json({ success: false, error: "ORDER_FAILED" });
    }

    await client.XADD("orders", "*", {
        type: "order.created",
        orderId: order.id,
        userId: userId,
        marketId: order.marketId,
        side: data.side,
        price: data.price,
        qty: data.qty,
        leverage: String(data.leverage),
        orderType: data.OrderType,
    });

    return res.status(200).json({
        success: true,
        data: order,
    });

})

app.get("/api/position", authMiddleware , async(req:Request , res:Response)=>{
    const userId= req.id;
    if(!userId){
        return res.status(404).json({
            success:false,
            error:"USERID_NOT_FOUND"
        })
    }
    const position = await prisma.position.findMany({
        where:{
            userId:userId
        }
    });
    return res.status(200).json({
        success:true,
        data:position
    })
})

app.get("/api/orders", authMiddleware , async(req:Request , res:Response)=>{
    const userId= req.id;
    if(!userId){
        return res.status(404).json({
            success:false,
            error:"USERID_NOT_FOUND"
        })
    }
    const orders = await prisma.order.findMany({
        where:{
            userId:userId
        },
        orderBy:{
            createdAt :"desc"
        }
    })
    return res.status(200).json({
        success:true,
        data:orders
    })
})

app.delete("/api/order/:id", authMiddleware , async(req:Request, res:Response)=>{
    const order = await prisma.order.findUnique({
        where:{
            id: req.params.id as string
        }
    });
    if(!order || order.userId !== req.id){
        return res.status(404).json({
            success:false,
            error:"ORDER_NOT_FOUND"
        });
    }

    if(order.status !== "OPEN" && order.status !== "PARTIALLY_FILLED"){
        return res.status(400).json({
            success:false,
            error:"NOT_CANCELLABLE"
        });
    }
    
    await client.xAdd("orders", "*", {
        type:"order.cancel",
        orderId:order.id,
        userId:req.id,
        marketId:order.marketId,
        side:order.side,
        price:order.price ?? "0",
    })
    return res.status(200).json({
        success:true,
        msg:"CANCEL_REQUESTED"
    });
})
// Public order book. The snapshot-worker keeps each market's book in Redis at
// orderbook:snapshot:<marketId>; we read it, aggregate per price level and
// return sorted bids (desc) and asks (asc).

app.get("/api/orderbook/:marketId", async (req: Request, res: Response) => {
    const raw = await client.get(`orderbook:snapshot:${req.params.marketId}`);
    if (!raw) {
        return res.status(200).json({
            success: true,
            data: { marketId: req.params.marketId, bids: [], asks: [], lastTradePrice: 0 },
        });
    }

    const book = JSON.parse(raw) as {
        marketId: string;
        bids: Record<string, { availableQty: number }>;
        asks: Record<string, { availableQty: number }>;
        lastTradePrice: number;
    };

    const levels = (side: Record<string, { availableQty: number }>) =>
        Object.entries(side)
            .map(([price, lvl]) => ({ price: Number(price), qty: lvl.availableQty }))
            .filter((l) => l.qty > 0);

    const bids = levels(book.bids).sort((a, b) => b.price - a.price);
    const asks = levels(book.asks).sort((a, b) => a.price - b.price);

    return res.status(200).json({
        success: true,
        data: { marketId: book.marketId, bids, asks, lastTradePrice: book.lastTradePrice },
    });
});

// Candlestick data proxied from Binance's public market-data API (no key
// needed). The browser can't call Binance directly here, and this keeps the
// chart backed by real OHLC instead of the session-only fills tape.
const KLINE_INTERVALS = new Set([
    "1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M",
]);
app.get("/api/klines/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const interval = KLINE_INTERVALS.has(String(req.query.interval)) ? String(req.query.interval) : "15m";
    const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 200));
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    try {
        const r = await fetch(url);
        if (!r.ok) {
            return res.status(502).json({ success: false, error: "BINANCE_REJECTED" });
        }
        const raw = (await r.json()) as any[];
        const candles = raw.map((k) => ({
            t: k[0],          // open time (ms)
            o: Number(k[1]),
            h: Number(k[2]),
            l: Number(k[3]),
            c: Number(k[4]),
            v: Number(k[5]),
        }));
        return res.json({ success: true, data: candles });
    } catch {
        return res.status(502).json({ success: false, error: "BINANCE_UNREACHABLE" });
    }
});

app.listen(3000, ()=>{
    console.log("listening on port 3000")
})