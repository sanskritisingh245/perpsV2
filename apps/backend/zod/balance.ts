import z from "zod";

export const balanceSchema=z.object({
    amount:z.string(),
    asset:z.string()
})