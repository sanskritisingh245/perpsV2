import { OrderStatus, prisma } from "@repo/db";
import { createClient } from "redis";


type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];



type FillMessage = {
    marketId:string;
    price:string;
    qty:string;
    takerUserId:string;
    takerOrderId:string;
    takerSide:string;
    takerLeverage:string;
    makerUserId:string;
    makerOrderId:string;
    makerLeverage:string;
};


const client=createClient();//publish message
await client.connect();

try{
    await client.xGroupCreate("fills", "settle-group", "0",
        {
            MKSTREAM:true
        }

    )
}catch(err){
    console.log(err)
}
// replay it's own un-acked fills from a pervious crash
const recovery = await client.xReadGroup(
    "settle-group", "worker-1",
    [{
        key:"fills", 
        id:"0"
    }],
    {
        COUNT:1000
    },
)

if(recovery) {
    for(const stream of recovery){
        for(const message of stream.messages){
            try{
                await settleFill(message.id , message.message as FillMessage);
                await client.xAck("fills", "settle-group", message.id);
            }catch(err : any){
                if(err ?. code === "P2002"){
                    //acking the already settled 
                    await client.xAck("fills", "settle-group",message.id);
                }else{
                    console.error("recovery failed, leaving pending:",message.id)
                }
            }
        }
    }
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
            try{
                await settleFill(message.id, message.message as FillMessage)
                await client.xAck("fills", "settle-group",
                    message.id
                )
            }catch(err){
                console.error("settle failed, leaving pending",message.id , err)
            }
        }
    }
}

async function settleFill(streamId : string , f:FillMessage) {
    await prisma.$transaction(async (tx) => {
        await tx.fill.create({
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
            const order = await tx.order.findUnique({
                where:{
                    id:orderId
                }
            })
            if(!order) continue;
    
            const newFilled = Number(order.filledQty) + Number(f.qty);
            const status = newFilled >= Number(order.qty)
            ?OrderStatus.FILLED
            :OrderStatus.PARTIALLY_FILLED
    
            await tx.order.update({
                where:{
                    id:orderId
                },
                data:{
                    filledQty:String(newFilled), status
                }
            })  
        }

        await applyPositionUpdate(tx, f.takerUserId, f.marketId, f.takerSide, Number(f.qty), Number(f.price),Number(f.takerLeverage));
        await applyPositionUpdate(tx, f.makerUserId, f.marketId, f.takerSide === "BUY" ? "SELL" : "BUY", Number(f.qty), Number(f.price), Number(f.makerLeverage));
    }, {
        maxWait:15000,
        timeout:30000,
    });
    
}

async function  applyPositionUpdate(
    tx:Tx,
    userId:string,
    marketId:string,
    side:string,
    qty:number,
    price:number,
    leverage:number
) {
    const positionType = side  === "BUY" ? "LONG" :"SHORT";

    const position = await tx.position.findUnique({
        where:{
            userId_marketId:{
                userId,
                marketId
            }
        }
    })

    if(!position){
        await tx.position.create({
            data:{
                userId,
                marketId,
                side:positionType,
                qty:String(qty),
                entryPrice:String(price),
                margin:String((price * qty)/leverage),
            }
        });
        return;
    }

    //same-side -> increase it (weighted-average entry)
    if(position.side === positionType){
        const oldQty = Number(position.qty);
        const newQty= oldQty+qty;
        const newEntry = (oldQty *Number(position.entryPrice) + qty * price) /newQty;
        const newMargin = Number(position.margin) + price*qty/leverage;

        await tx.position.update({
            where:{userId_marketId :{
                userId,
                marketId
            }},
            data:{
                qty:String(newQty),
                entryPrice:String(newEntry),
                margin: String(newMargin),

            }
        });
        return;
    }
    //opposite side -> closing/reducing

    const posQty = Number(position.qty);
    const entry = Number(position.entryPrice);
    const margin = Number(position.margin);

    const realizedPnl = position.side === "LONG"
        ?(price - entry) *qty
        :(entry - price) *qty

    if(qty === posQty){
        await tx.balance.update({
            where:{
                userId_asset:{
                    userId, 
                    asset:marketId
                }
            },
            data:{
                locked:{
                    decrement :margin
                },
                available:{
                    increment: margin+realizedPnl
                },
            },
        });
        await tx.position.delete({
            where:{
                userId_marketId:{
                    userId, 
                    marketId
                }
            }
        });
        return;
    }

    if(qty < posQty){
        const marginReleased = margin *(qty / posQty);

        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:marketId
                }
            },
            data:{
                locked:{
                    decrement :marginReleased
                },
                available:{
                    increment:marginReleased + realizedPnl
                },
            },
        });

        await tx.position.update({
            where:{
                userId_marketId:{
                    userId,
                    marketId
                }
            },
            data:{
                qty: String(posQty -qty),
                margin:String(margin - marginReleased)
            },
        });
        return;
    }
    if(qty > posQty){
        const closePnl = position.side === "LONG"
            ?(price - entry) * posQty
            :(entry - price) * posQty
        
        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:marketId
                }
            },data:{
                locked:{
                    decrement :margin
                },
                available:{
                    increment:margin+closePnl
                },
            },
        });
        
        const newQty = qty - posQty;
        await tx.position.update({
            where:{
                userId_marketId:{
                    userId,
                    marketId
                }
            },
            data:{
                side:positionType,
                qty:String(newQty),
                entryPrice:String(price),
                margin:String((price * newQty)/leverage),
            },
        });
        return;
    }
}