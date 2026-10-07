import z from "zod";
import { positiveDecimal } from "./order";

export const balanceSchema=z.object({
    // test faucet: cap a single deposit so one call can't mint an absurd amount
    amount:positiveDecimal.refine((v) => Number(v) <= 1_000_000),
    asset:z.string()
})
