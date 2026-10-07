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
const TOKEN_TTL = "7d"; // expired tokens 401 -> the web app drops back to guest mode


const client=createClient({ url: process.env.REDIS_URL });//publish message (falls back to localhost when REDIS_URL is unset)
// node-redis rethrows unlistened "error" events as uncaught exceptions, which
// kills the whole process (this is what crash-looped the service when the
// Upstash plan's request quota ran out — every command errored, and every
// error took the process down with it). Logging instead keeps the rest of
// the API (markets, klines, auth) serving even while Redis itself is down.
client.on("error", (err) => console.error("[redis] error", err?.message ?? err));
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

    // Return a token too, so the client is logged in straight after signup
    // instead of needing a separate /signin round trip.
    const token= jwt.sign({
        id:response.id,
        username:response.username
    },JWT_SECRET,{ expiresIn: TOKEN_TTL })
    res.json({
        success:true,
        id:response.id,
        data:token
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
    },JWT_SECRET,{ expiresIn: TOKEN_TTL })
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

// Admin-only. Nothing has a foreign key to Market, so deleting one that still
// has open orders/positions would orphan them (and their locked margin) —
// refuse until the market is flat.
app.delete("/api/admin/market/:id", async (req:Request, res:Response) => {
    if (req.headers.authorization !== ADMIN_SECRET){
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    const id = req.params.id as string;
    const [openOrders, positions] = await Promise.all([
        prisma.order.count({ where: { marketId: id, status: { in: ["OPEN", "PARTIALLY_FILLED"] } } }),
        prisma.position.count({ where: { marketId: id } }),
    ]);
    if (openOrders || positions) {
        return res.status(409).json({ success: false, error: "MARKET_IN_USE" });
    }
    const { count } = await prisma.market.deleteMany({ where: { id } });
    if (!count) {
        return res.status(404).json({ success: false, error: "MARKET_NOT_FOUND" });
    }
    marketIds.delete(id); // stop accepting new orders for it immediately
    return res.json({ success: true });
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

// Publishes the "order.created" event to the `orders` Redis stream, which is
// the only way the matching engine learns about a new order. Retries a few
// times with backoff to ride out brief Redis blips before giving up.
async function publishOrderCreated(
    order: { id: string; marketId: string; orderType: string; side: string; price: string | null; qty: string; leverage: number },
    userId: string,
    attempts = 3,
): Promise<boolean> {
    const fields = {
        type: "order.created",
        orderId: order.id,
        userId,
        marketId: order.marketId,
        side: order.side,
        price: order.price ?? "0",
        qty: order.qty,
        leverage: String(order.leverage),
        orderType: order.orderType,
    };
    for (let i = 0; i < attempts; i++) {
        try {
            await client.XADD("orders", "*", fields);
            return true;
        } catch (err: any) {
            console.error(`[order] XADD attempt ${i + 1}/${attempts} failed`, order.id, err?.message ?? err);
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
        }
    }
    return false;
}

// Safety net for the rare case where publishOrderCreated exhausted its
// retries above (e.g. Redis was down longer than ~1s): periodically look for
// orders whose "order.created" event never reached the stream and republish
// them. Without this, such an order sits OPEN forever — the matching engine
// only discovers orders via that stream. The matching engine's own
// in-process de-dupe (`processed` set in apps/matching-engine/index.ts) makes
// a redundant republish harmless if it actually did get through the first time.
async function reconcileUnpublishedOrders() {
    try {
        const stale = await prisma.order.findMany({
            where: {
                eventPublished: false,
                status: "OPEN",
                createdAt: { lt: new Date(Date.now() - 5_000) },
            },
            take: 50,
        });
        for (const order of stale) {
            const published = await publishOrderCreated(order, order.userId);
            if (published) {
                await prisma.order.update({ where: { id: order.id }, data: { eventPublished: true } });
                console.log("[order] reconciliation republished", order.id);
            }
        }
    } catch (err: any) {
        console.error("[order] reconciliation sweep failed", err?.message ?? err);
    }
}
setInterval(reconcileUnpublishedOrders, 15_000);

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
                    leverage: data.leverage,
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

    // The order is already committed at this point; a failure publishing the
    // event shouldn't turn into a "server error" for an order that actually
    // succeeded. publishOrderCreated retries a few times on its own; if it
    // still fails, eventPublished stays false and the reconciliation sweep
    // below picks it up later instead of the order sitting OPEN forever.
    const published = await publishOrderCreated(order, userId);
    if (published) {
        try {
            await prisma.order.update({ where: { id: order.id }, data: { eventPublished: true } });
        } catch (err: any) {
            console.error("[order] failed to mark eventPublished", order.id, err?.message ?? err);
        }
    } else {
        console.error("[order] giving up on publish after retries; reconciliation sweep will retry", order.id);
    }

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
    // All open orders (the user must be able to see/cancel every one) plus the
    // latest 50 for history — returning every order ever placed got huge, and
    // the UI polls this every 4s.
    const [open, recent] = await Promise.all([
        prisma.order.findMany({
            where:{ userId, status:{ in:["OPEN", "PARTIALLY_FILLED"] } },
            orderBy:{ createdAt:"desc" },
        }),
        prisma.order.findMany({
            where:{ userId },
            orderBy:{ createdAt:"desc" },
            take:50,
        }),
    ]);
    const byId = new Map([...open, ...recent].map((o) => [o.id, o]));
    const orders = [...byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

// Redis can lose the last trade price (snapshot predates a fill, or Redis was
// wiped); fall back to the newest settled fill in Postgres so clients can
// still price market orders / uPnL straight after load.
// ponytail: unindexed scan on Fill.market_id, add an index if fills grow large
async function lastFillPrice(marketId: string): Promise<number> {
    const f = await prisma.fill.findFirst({ where: { market_id: marketId }, orderBy: { createdAt: "desc" } });
    return f ? Number(f.price) : 0;
}

app.get("/api/orderbook/:marketId", async (req: Request, res: Response) => {
    const marketId = req.params.marketId as string;
    const raw = await client.get(`orderbook:snapshot:${marketId}`);
    if (!raw) {
        return res.status(200).json({
            success: true,
            data: { marketId, bids: [], asks: [], lastTradePrice: await lastFillPrice(marketId) },
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
        data: { marketId: book.marketId, bids, asks, lastTradePrice: book.lastTradePrice || await lastFillPrice(marketId) },
    });
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