import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export const COLLATERAL = "USD";
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });

// Re-export generated types/enums (Side, OrderStatus, OrderType, etc.)
export * from "./generated/prisma/client";
