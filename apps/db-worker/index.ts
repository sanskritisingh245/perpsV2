import { COLLATERAL, OrderStatus, prisma, Prisma } from "@repo/db";
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


const client=createClient({ url: process.env.REDIS_URL });// fills consumer + setup/recovery (falls back to localhost when REDIS_URL is unset)
await client.connect();

// consumeFills and consumeCancels both issue blocking xReadGroup(BLOCK:0) reads.
// node-redis serializes commands on one connection, so a blocking read on one
// stream head-of-line-blocks the other loop (and stalls settlement after the
// first message). Give the cancels loop its own connection.
const cancelClient = client.duplicate();
await cancelClient.connect();

try{
    await client.xGroupCreate("fills", "settle-group", "0",
        {
            MKSTREAM:true
        }

    )
}catch(err){
    console.log(err)
}
try{
    await client.xGroupCreate("cancels", "settle-group", "0", 
        {
            MKSTREAM:true
        }
    )
}catch(err){
    console.log(err);
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
            await settleAndAck(message.id, message.message as FillMessage);

        }
    }
}

async function consumeFills() { 
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
                await settleAndAck(message.id, message.message as FillMessage);

            }
        }
    
        const {messages : claimed} = await client.xAutoClaim("fills","settle-group", "worker-1", 60000, "0");
        for (const m of claimed){
            if(!m) continue;
            await settleAndAck(m.id, m.message as FillMessage);
        }                        
    }
}

async function consumeCancels() {
    while (true) {
        const response = await cancelClient.xReadGroup("settle-group", "worker-1",
            [{ key: "cancels", id: ">" }], { BLOCK: 0, COUNT: 10 });
        if (!response) continue;

        for (const stream of response) {
            for (const message of stream.messages) {
                try {
                    await settleCancel(message.message as { orderId: string; userId: string; unfilledQty: string });
                    await cancelClient.xAck("cancels", "settle-group", message.id);
                } catch (err) {
                    console.error("cancel settle failed", message.id, err);
                }
            }
        }
    }
}

// start both consumers concurrently (no await — each is an infinite loop)
consumeFills();
consumeCancels();


async function settleAndAck(id:string, msg:FillMessage) {
    try{
        await settleFill(id,msg);
        await client.xAck("fills", "settle-group", id);
    }catch(err:any){
        if(err?.code === "P2002"){
            await client.xAck("fills", "settle-group", id);
        }else{
            console.log("settle failed , leaving pending:" , id , err);
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
    
            const newFilled = new Prisma.Decimal(order.filledQty).add(f.qty);
            const status = newFilled.greaterThanOrEqualTo(order.qty)
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
        const takerOrder = await tx.order.findUnique({ where: { id: f.takerOrderId } });
        const makerOrder = await tx.order.findUnique({ where: { id: f.makerOrderId } });

        await applyPositionUpdate(
            tx, f.takerUserId, f.marketId, f.takerSide,
            new Prisma.Decimal(f.qty), new Prisma.Decimal(f.price), new Prisma.Decimal(f.takerLeverage),
            new Prisma.Decimal(takerOrder!.initialMargin), new Prisma.Decimal(takerOrder!.qty),
        );
        await applyPositionUpdate(
            tx, f.makerUserId, f.marketId, f.takerSide === "BUY" ? "SELL" : "BUY",
            new Prisma.Decimal(f.qty), new Prisma.Decimal(f.price), new Prisma.Decimal(f.makerLeverage),
            new Prisma.Decimal(makerOrder!.initialMargin), new Prisma.Decimal(makerOrder!.qty),
        );
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
    qty:Prisma.Decimal,
    price:Prisma.Decimal,
    leverage:Prisma.Decimal,
    reservation:Prisma.Decimal,
    orderQty:Prisma.Decimal,
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
        const M = price.mul(qty).div(leverage);
        const reservationFill = reservation.mul(qty).div(orderQty);
        await tx.position.create({
            data:{
                userId,
                marketId,
                side:positionType,
                qty:qty.toString(),
                entryPrice:price.toString(),
                margin:M.toString(),
            }
        });
        await tx.balance.update({
            where:{userId_asset:{
                userId,
                asset:COLLATERAL
            }},
            data:{
                locked: {increment: M.sub(reservationFill)},
                available: {increment : reservationFill.sub(M)}
            }
        })
        return;
    }

    //same-side -> increase it (weighted-average entry)
    if(position.side === positionType){
        const oldQty = new Prisma.Decimal(position.qty);
        const newQty = oldQty.add(qty);
        const newEntry = oldQty.mul(position.entryPrice).add(qty.mul(price)).div(newQty);
        const M = price.mul(qty).div(leverage); // the real margin this position needs, calculated at the actual fill price
        const newMargin = new Prisma.Decimal(position.margin).add(M);
        const reservationForFill = reservation.mul(qty).div(orderQty); // amount backend already locked for this fill

        await tx.position.update({
            where:{userId_marketId :{
                userId,
                marketId
            }},
            data:{
                qty:newQty.toString(),
                entryPrice:newEntry.toString(),
                margin: newMargin.toString(),

            }
        });

        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:COLLATERAL
                }
            },data:{
                locked: { increment : M.sub(reservationForFill)},
                available: { increment : reservationForFill.sub(M)}
            }
        })
        return;
    }
    //opposite side -> closing/reducing

    const posQty = new Prisma.Decimal(position.qty);
    const entry = new Prisma.Decimal(position.entryPrice);
    const margin = new Prisma.Decimal(position.margin);

    const realizedPnl = position.side === "LONG"
        ? price.sub(entry).mul(qty)
        : entry.sub(price).mul(qty)

    if(qty.equals(posQty)){
        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:COLLATERAL
                }
            },
            data:{
                locked:{
                    decrement :margin
                },
                available:{
                    increment: margin.add(realizedPnl)
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

    if(qty.lessThan(posQty)){
        const marginReleased = margin.mul(qty).div(posQty);

        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:COLLATERAL
                }
            },
            data:{
                locked:{
                    decrement :marginReleased
                },
                available:{
                    increment:marginReleased.add(realizedPnl)
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
                qty: posQty.sub(qty).toString(),
                margin:margin.sub(marginReleased).toString()
            },
        });
        return;
    }
    if(qty.greaterThan(posQty)){
        const closePnl = position.side === "LONG"
            ? price.sub(entry).mul(posQty)
            : entry.sub(price).mul(posQty)

        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:COLLATERAL
                }
            },data:{
                locked:{
                    decrement :margin
                },
                available:{
                    increment:margin.add(closePnl)
                },
            },
        });

        const newQty = qty.sub(posQty);
        const M = price.mul(newQty).div(leverage);
        const reservationForFill = reservation;

        await tx.position.update({
            where:{
                userId_marketId:{
                    userId,
                    marketId
                }
            },
            data:{
                side:positionType,
                qty:newQty.toString(),
                entryPrice:price.toString(),
                margin:M.toString(),
            },
        });
        await tx.balance.update({
            where:{
                userId_asset:{
                    userId,
                    asset:COLLATERAL
                }
            },data:{
                locked : { increment : M.sub(reservationForFill)},
                available: { increment : reservationForFill.sub(M)},
            }
        })
        return;
    }
}

async function settleCancel(c: {orderId: string; userId: string; unfilledQty: string }) {
    await prisma.$transaction(async (tx)=>{
        const order = await tx.order.findUnique({
            where:{
                id:c.orderId
            }
        });
        if(!order) return;

        const released = new Prisma.Decimal(order.initialMargin).mul(c.unfilledQty).div(order.qty);
        await tx.balance.update({
            where:{
                userId_asset:{
                    userId:c.userId, 
                    asset:COLLATERAL
                }
            },data:{
                locked: { decrement : released},
                available:{ increment : released},
            }
        })
        await tx.order.update({
            where:{
                id:c.orderId,
            },data:{
                status: "CANCELLED"
            }    
        });
    })
    
}