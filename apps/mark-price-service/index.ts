import { createClient } from "redis";
import { COLLATERAL, prisma, Prisma } from  "@repo/db";
 
const client = createClient();
await client.connect();

// The consumer loop below issues a blocking xReadGroup(BLOCK:0) on `client`,
// which head-of-line-blocks every other command on that connection until a
// fill arrives. The liquidation interval reads mark prices, so give it its own
// connection — otherwise liquidations stall whenever the market is quiet.
const markClient = client.duplicate();
await markClient.connect();

try{
    await client.xGroupCreate("fills", "markprice-group", "0",
        {
            MKSTREAM:true
        }
    )
}catch(e){
    console.log(e);
}
setInterval(async ()=> {
    const positions = await prisma.position.findMany();
    for(const pos of positions){
        const mark = Number(await markClient.get(`markprice:${pos.marketId}`));
        if(!mark) continue;

        const entry = Number(pos.entryPrice);
        const qty= Number(pos.qty);
        const margin= Number(pos.margin);

        const liqPrice= pos.side === "LONG" 
            ? entry - margin/qty
            : entry + margin/qty;
        
        const ShouldLiqudate = pos.side === "LONG" 
            ? mark <= liqPrice
            : mark >=liqPrice;

        if(ShouldLiqudate){
            await prisma.$transaction(async(tx)=>{
             //entire margin consumed 
                await tx.balance.update({ //removing from the table
                    where:{userId_asset :{
                        userId:pos.userId,
                        asset:COLLATERAL
                     }
                    },data:{
                        locked :{
                            decrement :margin
                        }
                    },
                });
                await tx.position.delete({ //deleting it from the table 
                    where:{
                        id:pos.id
                    }
                });
            });
            console.log(`LIQUIDATED ${pos.userId.slice(0,8)} ${pos.side} qty ${qty} @ entry ${entry} (liq ${liqPrice}, mark ${mark}`);
        }
    }  
},1000)

while(true){
    const response= await client.xReadGroup("markprice-group", "markprice-1", 
        [{
            key:"fills",
            id:">"
        }],
        {
            BLOCK:0,
            COUNT:10
        },
    );
    if(!response) continue;
    for(const stream of response){
        for(const message of stream.messages){
            const {marketId , price} = message.message;
            await client.set(`markprice:${marketId}`, price); //price  is last trade price
            await client.xAck("fills", "markprice-group", message.id)
        }
    }

}