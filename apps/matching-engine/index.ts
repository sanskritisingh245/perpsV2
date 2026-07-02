import { createClient } from "redis";
import { match } from "./helper/helper";
import { restOrder , getOrCreateBook , restoreBook, removeOrder  } from "./src/book";

const client= createClient({ url: process.env.REDIS_URL });
await client.connect();

// The consumer group must exist before xReadGroup can read from it.
try {
    await client.xGroupCreate("orders", "engine-group", "0", { MKSTREAM: true });
} catch {
    // group already exists — fine
}
const snapKeys = await client.keys("orderbook:snapshot:*");
for(const key of snapKeys){
    const data = await client.get(key);
    if(data) restoreBook(JSON.parse(data));
}
console.log(`restored ${snapKeys.length} order book from snapshot`);

const processed = new Set <string>();
while(true){
    try{

        const response = await client.xReadGroup("engine-group", "engine-1", 
            [
                {
                    key:"orders",
                    id:">"
                }
            ],{
                BLOCK:0,
                COUNT:1,
            }
        );
    
        if(!response){
            continue;
        }
    
        const stream=response[0];
        const message=stream?.messages[0]
        if(!message) continue;
        const order= message.message;
        if(order.type === "order.cancel"){
            const removed = removeOrder(order.marketId, order.side as "BUY" | "SELL", Number(order.price), order.orderId);

            if(removed){
                await client.xAdd("cancels", "*", {
                    orderId: order.orderId,
                    userId: order.userId,
                    unfilledQty:String(removed.qty - removed.filledQty),
                });
            }
            await client.xAck("orders", "engine-group", message.id);
            continue;
        }
        if(processed.has(order.orderId)){
            await client.xAck("orders", "engine-group", message.id);
            continue;
        }
    
        const qty = Number(order.qty);
        const price = Number(order.price);
        const side= order.side as "BUY" | "SELL";
        const leverage= Number(order.leverage);

        const isMarket = order.orderType === "MARKET";
        const matchPrice= isMarket ? (side === "BUY" ? Infinity :0) : price;
    
        const {fills , remainingQty} = match(order.userId, order.orderId, order.marketId, side, qty, matchPrice , leverage);
    
        for (const f of fills){
            await client.xAdd("fills", "*", {
                marketId:order.marketId,
                price:String(f.price),
                qty:String(f.qty),
                takerUserId:f.takerUserId,
                takerOrderId:f.takerOrderId,
                takerSide:side,
                takerLeverage:String(f.takerLeverage),
                makerUserId:f.makerUserId,
                makerOrderId:f.makerOrderId,
                makerLeverage:String(f.makerLeverage),
            });
        }
    
        // Leftover taker quantity rests in the book as a new maker order.
        if(remainingQty > 0 ){
            if(isMarket){
                await client.xAdd("cancels", "*", {
                    orderId:order.orderId,
                    userId:order.userId,
                    unfilledQty: String(remainingQty),
                });
            }else{
                restOrder(order.marketId, side, price, {
                    userId: order.userId,
                    orderId: order.orderId,
                    qty: remainingQty,
                    filledQty: 0,
                    leverage,
                });
            }
        }
    
        const book = getOrCreateBook(order.marketId);
        if(fills.length) book.lastTradePrice = fills[fills.length -1]!.price; 
        processed.add(order.orderId);
        await client.xAdd("book-updates", "*", {
            marketId:order.marketId,
            book:JSON.stringify(book),
        });
    
        await client.xAck("orders", "engine-group", message.id)
    }catch(err){
        console.log(err)
    }
}

