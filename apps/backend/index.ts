import express, { type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { SignupSchema } from "./zod/auth";
import { COLLATERAL, OrderType, prisma, Prisma } from "@repo/db";
import  jwt  from "jsonwebtoken";
import { authMiddleware } from "./authMiddleware";
import { balanceSchema } from "./zod/balance";
import { OrderSchema } from "./zod/order";
import { createClient } from "redis";
import { success } from "zod";
import { tr } from "zod/locales";



const JWT_SECRET=process.env.JWT_SECRET||"";
const ADMIN_SECRET=process.env.ADMIN_SECRET || "";


const client=createClient();//publish message
client.connect();



const app = express();
app.use(express.json());

app.post("/api/signup", async (req: Request, res: Response) =>{
    const {success, data}= SignupSchema.safeParse(req.body);
    if (!success) {
      return res.status(411).json({
        success: false,
        error: "INVALID_DATA",
      });
    }
    if(!data.username || !data.password){
        return res.status(411).json({
            success:false,
            error:"DATA_NOT_PROVIDED"
        })
    }

    const user=await prisma.user.findUnique({
        where:{username:data.username}
    })
    if(user){
        return res.status(400).json({
            success:false,
            error:"USERNAME_ALREADY_EXSIST"
        })
    }
    const hashPassowrd=await bcrypt.hash(data.password,10)
    const response = await prisma.user.create({
        data:{
            username:data.username,
            password: hashPassowrd
        }
    })

    res.json({
        success:true,
        id:response.id
    })
})

app.post("/api/signin", async (req:Request, res:Response)=>{
    const {success, data}= SignupSchema.safeParse(req.body);
    if (!success) {
      return res.status(403).json({
        success: false,
        error: "INVALID_DATA",
      });
    }
    if(!data.username || !data.password){
        return res.status(411).json({
            success:false,
            error:"DATA_NOT_PROVIDED"
        })
    }

    const user=await prisma.user.findUnique({
        where:{username:data.username}
    })
    if(!user){
        return res.status(403).json({
            success:false,
            error:"INCORRECT_CREDENTIALS"
        })
    }
    const password= await bcrypt.compare(data.password, user.password)
        if(!password){
            return res.status(400).json({
                success:false,
                error:"INCORRECT_PASSWORD"
            })
        }
        
    const token= jwt.sign({
        id:user.id,
        username:user.username
    },JWT_SECRET)
    console.log("token", token )
    return res.status(200).json({
        success:true,
        data:token,
        msg:"SUCCESSFULLY_SIGNEDIN"
    })

})

app.post("/api/admin/market", async (req:Request, res:Response) => {
    if (req.headers.authorization !== ADMIN_SECRET){
        return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    const market = await prisma.market.create({ data: { slug: req.body.slug, imageUrl: req.body.imageUrl } });
    return res.json({ success: true, data: market });
});


app.post ("/api/on-ramp",authMiddleware, async(req:Request, res:Response)=>{
    const userId=req.id 
    const {success, data}= balanceSchema.safeParse(req.body);
    if(!success){
       return res.status(403).json({
        success: false,
        error: "INVALID_DATA",
      }); 
    }

    const balance= await prisma.balance.upsert({
        where:{
            userId_asset:{
                userId:userId,
                asset:COLLATERAL
            }
        },
        update:{
            available:{
                increment:data.amount
            },
        },
        create:{
            userId,
            asset:COLLATERAL,
            available:data.amount,
            locked:"0"
        },      
    });
    return res.status(200).json({
        success:true,
        msg:"balance successfully added"
    })

})

app.get("/api/balance", authMiddleware, async(req:Request, res:Response)=>{
    const userId=req.id;

    const balance= await prisma.balance.findUnique({
        where:{
            userId_asset:{
                userId:userId,
                asset:COLLATERAL
            }
        }
    })

    if(!balance){
        return res.status(404).json({
            success:false,
            error:"BALANCE_NOT_FOUND"
        })
    }

    return res.status(200).json({
        success:true,
        data:balance
    })
})

app.post("/api/order", authMiddleware , async(req:Request, res:Response)=>{
    const userId=req.id;

    const {success, data} = OrderSchema.safeParse(req.body);
    if(!success){
       return res.status(403).json({
        success: false,
        error: "INVALID_DATA",
      });  
    }
    //rejecting unknown markets
    const market = await prisma.market.findUnique({ where: { id: data.market } });
    if (!market) {
        return res.status(400).json({ success: false, error: "INVALID_MARKET" });
    }

    const position = await prisma.position.findUnique({
        where:{
            userId_marketId:{
                userId,
                marketId:data.market
            }
        },
    });

    const orderDir = data.side === "BUY" ? "LONG" :"SHORT";
    const orderQty = new Prisma.Decimal(data.qty);

    let openingQty= orderQty;
    if(position && position.side !== orderDir){
        const posQty = new Prisma.Decimal(position.qty);
        openingQty =orderQty.greaterThan(posQty) ? orderQty.minus(posQty) : new Prisma.Decimal(0);
    }

    const requiredMargin  = new Prisma.Decimal(data.price).mul(openingQty).div(data.leverage);
    const balance= await prisma.balance.findUnique({
        where:{
            userId_asset:{
                userId:userId,
                asset:COLLATERAL
            }
        }
    })

    if(!balance){
        return res.status(404).json({
            success:false,
            error:"BALANACE_NOT_FOUND"
        })
    }

    const availableBalance= balance.available;

    if (availableBalance.lessThan(requiredMargin)) {
      return res.status(400).json({
        success: false,
        error: "NOT_ENOUGH_BALANCE",
      });
    }

    await prisma.balance.update({
        where:{
            userId_asset:{
                userId:userId,
                asset:COLLATERAL
            }
        },
        data:{
            available:{
                decrement: requiredMargin
            },
            locked:{
                increment: requiredMargin
            }
        }
    })

    const order = await prisma.order.create({
        data:{
            userId,
            marketId:data.market,
            orderType:data.OrderType,
            side:data.side,
            price:data.price,
            qty:data.qty,
            initialMargin:requiredMargin.toString(),
            filledQty:"0",
            status:"OPEN",
        }
    })

    await client.XADD("orders", "*", {
        type: "order.created",
        orderId: order.id,
        userId: userId,
        marketId: order.marketId,
        side:data.side,
        price: data.price,
        qty: data.qty,
        leverage:String(data.leverage),
    });

    return res.status(200).json({
        success: true,
        data: order,
    });
})

app.get("/api/position", authMiddleware , async(req:Request , res:Response)=>{
    const userId= req.id;
    if(!userId){
        return res.status(404).json({
            success:false,
            error:"USERID_NOT_FOUND"
        })
    }
    const position = await prisma.position.findMany({
        where:{
            userId:userId
        }
    });
    return res.status(200).json({
        success:true,
        data:position
    })
})

app.get("/api/orders", authMiddleware , async(req:Request , res:Response)=>{
    const userId= req.id;
    if(!userId){
        return res.status(404).json({
            success:false,
            error:"USERID_NOT_FOUND"
        })
    }
    const orders = await prisma.order.findMany({
        where:{
            userId:userId
        },
        orderBy:{
            createdAt :"desc"
        }
    })
    return res.status(200).json({
        success:true,
        data:orders
    })
})

app.delete("/api/order/:id", authMiddleware , async(req:Request, res:Response)=>{
    const order = await prisma.order.findUnique({
        where:{
            id: req.params.id as string
        }
    });
    if(!order || order.userId !== req.id){
        return res.status(404).json({
            success:false,
            error:"ORDER_NOT_FOUND"
        });
    }

    if(order.status !== "OPEN" && order.status !== "PARTIALLY_FILLED"){
        return res.status(400).json({
            success:false,
            error:"NOT_CANCELLABLE"
        });
    }
    
    await client.xAdd("orders", "*", {
        type:"order.cancel",
        orderId:order.id,
        userId:req.id,
        marketId:order.marketId,
        side:order.side,
        price:order.price ?? "0",
    })
    return res.status(200).json({
        success:true,
        msg:"CANCEL_REQUESTED"
    });
})
app.listen(3000, ()=>{
    console.log("listening on port 3000")
})