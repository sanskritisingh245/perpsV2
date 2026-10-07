import z from "zod";

// Plain positive decimal: rejects "abc", "-1", "0", "1e5", "". Negative qty /
// price / amount used to flip the margin math and credit free balance.
export const positiveDecimal = z.string()
    .regex(/^\d+(\.\d+)?$/)
    .refine((v) => Number(v) > 0);

export const OrderSchema=z.object({
    market:z.string(),
    side:z.enum(["BUY" , "SELL"]),
    price:positiveDecimal,
    qty:positiveDecimal,
    OrderType:z.enum(["LIMIT" , "MARKET"]),
    leverage:z.number().int().min(1).max(100), // matches the UI slider
})
