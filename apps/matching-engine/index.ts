import { createClient } from "redis";
import { match } from "./helper/helper";
import { restOrder } from "./src/book";

const client= createClient();
await client.connect();

// The consumer group must exist before xReadGroup can read from it.
try {
    await client.xGroupCreate("orders", "engine-group", "0", { MKSTREAM: true });
} catch {
    // group already exists — fine
}

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

    const {fills , remainingQty} = match(order.userId, order.orderId, order.marketId, side, qty, price);

    for (const f of fills){
        await client.xAdd("fills", "*", {
            marketId:order.marketId,
            price:String(f.price),
            qty:String(f.qty),
            takerUserId:f.takerUserId,
            takerOrderId:f.takerOrderId,
            takerSide:side,
            makerUserId:f.makerUserId,
            makerOrderId:f.makerOrderId
        });
    }

    // Leftover taker quantity rests in the book as a new maker order.
    if(remainingQty > 0 ){
        restOrder(order.marketId, side, price, {
            userId: order.userId,
            orderId: order.orderId,
            qty: remainingQty,
            filledQty: 0,
        });
    }

    await client.xAck("orders", "engine-group", message.id)
    

}

