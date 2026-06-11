import { createClient } from "redis";
import { match } from "./helper/helper";
import { restOrder , getOrCreateBook , restoreBook  } from "./src/book";

const client= createClient();
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
while(true){
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
    const order= message.message;

    const qty = Number(order.qty);
    const price = Number(order.price);
    const side= order.side as "BUY" | "SELL";
    const leverage= Number(order.leverage);

    const {fills , remainingQty} = match(order.userId, order.orderId, order.marketId, side, qty, price , leverage);

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
        restOrder(order.marketId, side, price, {
            userId: order.userId,
            orderId: order.orderId,
            qty: remainingQty,
            filledQty: 0,
            leverage,
        });
    }

    const book = getOrCreateBook(order.marketId);
    await client.xAdd("book-updates", "*", {
        marketId:order.marketId,
        book:JSON.stringify(book),
    });

    await client.xAck("orders", "engine-group", message.id)
    

}

