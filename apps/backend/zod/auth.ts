import z from "zod";

export const SignupSchema= z.object({
    username:z.string(),
    password:z.string()
})

