import { createClient } from "redis";

const client= createClient();
client.connect();

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
    

    




    


}

