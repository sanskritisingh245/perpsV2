import { OrderType } from "@repo/db";
import z from "zod";

export const OrderSchema=z.object({
    market:z.string(),
    side:z.enum(["BUY" , "SELL"]),
    price:z.string(),
    qty:z.string(),
    OrderType:z.enum(["LIMIT" , "MARKET"]),
    leverage:z.number(),
})

