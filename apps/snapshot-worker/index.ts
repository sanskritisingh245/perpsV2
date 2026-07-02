import { createClient } from "redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

try{
    await client.xGroupCreate("book-updates", "snapshot-group", "0",{
        MKSTREAM:true
    });
}catch(e:any){
    console.log(e.message)
}

while(true){
    const response = await client.xReadGroup("snapshot-group", "snapshot-1",
        [{
            key:"book-updates",
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
            const {marketId , book} = message.message;
            await client.set(`orderbook:snapshot:${marketId}`, book);
            await client.xAck("book-updates", "snapshot-group",message.id);
        }
    }
}