import { createClient } from "redis";
import { prisma, Prisma } from  "@repo/db";
 
const client = createClient();
await client.connect();

try{
    await client.xGroupCreate("fills", "markprice-group", "0",
        {
            MKSTREAM:true
        }
    )
}catch(e){
    console.log(e);
}

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
            try{
                const {marketId , price} = message.message;
                await client.set(`markprice:${marketId}`, price);
                const mark = Number(price);
                const positions = await prisma.position.findMany({
                    where:{
                        marketId
                    }
                })
                for (const pos of positions){
                    const entry = Number(pos.entryPrice);
                    const qty = Number(pos.qty);
                    const margin = Number(pos.margin);
                    
                    //price where loss would be equal to the margin

                    const liqPrice= pos.side === "LONG"
                        ?entry-margin /qty
                        :entry+margin/qty

                    const ShouldLiqudate= pos.side === "LONG"
                        ?mark<= liqPrice
                        :mark>=liqPrice

                    if(ShouldLiqudate){
                        await prisma.$transaction(async(tx)=>{
                            //entire margin consumed 
                            await tx.balance.update({ //removing from the table
                                where:{userId_asset :{
                                        userId:pos.userId,
                                        asset:marketId
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
                console.log(`mark price ${marketId} =${price}`);
                await client.xAck("fills", "markprice-group", message.id);
            }catch(err){
                console.error("markprice failed:", message.id, err)
            }
        }
    }
}