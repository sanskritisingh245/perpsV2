import { OrderStatus, prisma } from "@repo/db";
import { createClient } from "redis";

type FillMessage = {
    marketId:string;
    price:string;
    qty:string;
    takerUserId:string;
    takerOrderId:string;
    takerSide:string;
    makerUserId:string;
    makerOrderId:string;
};


const client=createClient();//publish message
await client.connect();

try{
    await client.xGroupCreate("fills", "settle-group", "0",
        {
            MKSTREAM:true
        }

    )
}catch{

}

while(true){
    const response = await client.xReadGroup("settle-group", "worker-1",
        [{
            key:"fills",
            id:">"
        }],
        {
            BLOCK:0,
            COUNT:10
        }
    );
    if(!response) continue;

    for(const stream of response){
        for(const message of stream.messages){
            console.log(message.message);
            await client.xAck("fills", "settle-group",
                message.id
            )
        }
    }
}

async function settleFill(streamId : string , f:FillMessage) {
    await prisma.fill.create({
        data:{
            id:streamId,
            maker_id:f.makerUserId,
            taker_id:f.takerUserId,
            maker_order_id:f.makerOrderId,
            taker_order_id:f.takerOrderId,
            qty:f.qty,
            price:f.price,
            market_id:f.marketId   
        }
    })

    for (const orderId of [f.makerOrderId, f.takerOrderId]){
        const order = await prisma.order.findUnique({
            where:{
                id:orderId
            }
        })
        if(!order) continue;

        const newFilled = Number(order.filledQty) + Number(f.qty);
        const status = newFilled >= Number(order.qty)
        ?OrderStatus.FILLED
        :OrderStatus.PARTIALLY_FILLED

        await prisma.order.update({
            where:{
                id:orderId
            },
            data:{
                filledQty:String(newFilled), status
            }
        })
    }
    
}