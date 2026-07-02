import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export const COLLATERAL = "USD";
// Resilient pool config: serverless Postgres (Neon) drops idle connections, so a
// long-lived idle worker can reuse a dead one and hang forever. We proactively
// recycle idle connections, fail fast on connect, and time out stuck queries so
// a transaction errors (and gets retried) instead of wedging the worker loop.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10_000,        // close idle conns before Neon kills them
  connectionTimeoutMillis: 10_000,  // fail a bad connect instead of hanging
  keepAlive: true,
  statement_timeout: 20_000,        // abort a stuck query
  query_timeout: 20_000,
});

export const prisma = new PrismaClient({ adapter });

// Re-export generated types/enums (Side, OrderStatus, OrderType, etc.)
export * from "./generated/prisma/client";
