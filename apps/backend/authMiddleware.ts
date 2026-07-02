import type {  Request,  Response ,NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

const JWT_SECRET=process.env.JWT_SECRET;
if(!JWT_SECRET) throw new Error("JWT_SECRET must be set");

declare global {
    namespace Express {
        interface Request {
            id: string
        }
    }
}

export const authMiddleware=(req:Request, res:Response, next:NextFunction)=>{
    try{
        //console.log(req.headers)
        const token= req.headers.authorization;
        //console.log("asd", token)
        if(!token){
            return res.status(401).json({
                success:false,
                error:"token not found ehhh"
            })
        }
        //console.log("dsadas")
        const decoded= jwt.verify(token,JWT_SECRET) as JwtPayload;
        if(!decoded){
            return res.status(403).json({
                success:false,
                error:"UNAUTHORIZED"
            })
        }
        req.id=decoded.id;
        next();
    }catch(e:any){
        return res.status(401).json({
        success: false,
        msg: "INCORRECT_TOKEN",
      });
    }
}