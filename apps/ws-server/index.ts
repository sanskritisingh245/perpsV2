import { createClient } from "redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

try{
    await client.xGroupCreate("fills", "ws-group", "0",
        {
            MKSTREAM:true
        }
    )
}catch(e){
    console.log(e);
}
const server = Bun.serve({
    port: Number(process.env.PORT) || 8080,
    fetch(req, server){
        if(server.upgrade(req)) return;
        return new Response("ws-server up");
    },
    websocket:{
        open(ws){
            ws.subscribe("fills");
            console.log("client connected");
        },
        close(ws){
            ws.unsubscribe("fills");
        },
        message(ws, msg) {},
    }
});

while(true){
    const response = await client.xReadGroup("ws-group", "ws-1",
        [
            {
                key:"fills",
                id: ">"
            }
        ],
        {
            BLOCK :0,
            COUNT:10
        },
    )
    if(!response) continue;

    for(const stream of response) {
        for(const message of stream.messages){
            server.publish("fills", JSON.stringify(message.message));
            await client.xAck("fills", "ws-group" , message.id);
        }
    }
}