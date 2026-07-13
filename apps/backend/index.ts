import express, { type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { SignupSchema } from "./zod/auth";
import { COLLATERAL, OrderType, prisma, Prisma } from "@repo/db";
import  jwt  from "jsonwebtoken";
import { authMiddleware } from "./authMiddleware";
import { balanceSchema } from "./zod/balance";
import { OrderSchema } from "./zod/order";
import { createClient } from "redis";



const JWT_SECRET=process.env.JWT_SECRET;
const ADMIN_SECRET=process.env.ADMIN_SECRET;
if(!JWT_SECRET || !ADMIN_SECRET){
    throw new Error("JWT_SECRET and ADMIN_SECRET must be set");
}


const client=createClient({ url: process.env.REDIS_URL });//publish message (falls back to localhost when REDIS_URL is unset)
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


// Public list of all markets so every client sees the same set (discovery),
// instead of each browser only knowing the markets it added locally.
app.get("/api/markets", async (_req: Request, res: Response) => {
    const markets = await prisma.market.findMany();
    return res.json({ success: true, data: markets });
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

// Candlestick history, proxied through us from Bybit (not Binance): Binance
// both geo-blocks our own Render IP AND gets domain-blocked by some ISPs for
// end users (its live WebSocket stream still works for those users only
// because it's on a different subdomain some blocklists haven't caught up
// to). Bybit's linear-perp symbols match Binance's ("BTCUSDT"), so no
// remapping is needed, and neither of those two blocks apply to it. Fetching
// here (rather than from the browser) means the client only ever talks to
// our own domain for history, so no exchange blocklist can interfere.
const BYBIT_INTERVAL: Record<string, string> = {
    "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "6h": "360", "8h": "360", "12h": "720",
    "1d": "D", "3d": "D", "1w": "W", "1M": "M",
};
app.get("/api/klines/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const interval = BYBIT_INTERVAL[String(req.query.interval)] ?? "15";
    const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 200));
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) {
            return res.status(502).json({ success: false, error: "BYBIT_REJECTED" });
        }
        const body = (await r.json()) as any;
        const list = (body?.result?.list ?? []) as any[];
        // Bybit returns newest-first; the chart wants oldest-first.
        const candles = list
            .map((k) => ({
                t: Number(k[0]),
                o: Number(k[1]),
                h: Number(k[2]),
                l: Number(k[3]),
                c: Number(k[4]),
                v: Number(k[5]),
            }))
            .reverse();
        return res.json({ success: true, data: candles });
    } catch {
        return res.status(502).json({ success: false, error: "BYBIT_UNREACHABLE" });
    }
});

// One-shot DB reachability probe: the logs show immediately (with the Prisma
// error code) whether THIS instance can actually talk to Postgres.
prisma.user.count()
    .then((n) => console.log(`[db] ok — ${n} users`))
    .catch((e: any) => console.error(`[db] STARTUP FAILED code=${e?.code} name=${e?.name} msg=${e?.message}`));

// Log the real cause of any 500 (esp. the Prisma code) instead of leaking a
// stack trace, and hand the client the code rather than "HTTP 500".
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error]", err?.code ?? "", err?.name ?? "", err?.message ?? err);
    res.status(500).json({ success: false, error: err?.code || "SERVER_ERROR" });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, ()=>{
    console.log(`listening on port ${PORT}`)
})