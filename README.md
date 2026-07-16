# perpV2

> A perpetual futures exchange built from scratch — order matching engine, cross-margin accounting, mark-price liquidations, and a live trading UI, wired together over Redis Streams with Postgres as the system of record.

---


https://github.com/user-attachments/assets/8fadb08c-94d0-49d9-a17a-fa1d400c83ad


## Why

Building a perp exchange means solving the same three problems every real venue does: matching orders fairly and fast, keeping every account's margin correct under concurrent fills, and never losing an order or a fill even when a service crashes mid-flight. perpV2 tackles all three with a deliberately small set of single-purpose services connected by Redis Streams, and Postgres as the durable source of truth — no service holds state the others can't recover from a restart.

## Features

- **Price/time-priority matching** — in-memory limit order book per market, partial fills, self-trade prevention (a user's own resting order is skipped rather than filled).
- **Market & limit orders** — market orders match immediately against the book; any unfilled remainder is cancelled outright (no resting market orders) and its margin released.
- **Cross-margin accounting** — only the exposure-increasing portion of an order locks new margin; an order that closes or reduces a position releases margin at settlement instead.
- **Mark-price liquidations** — a 1-second sweep marks every open position against the last traded price and force-closes anything that's crossed `entry ∓ margin/qty`.
- **Crash-safe by construction** — the order book is snapshotted to Redis after every match and restored by the matching engine on restart; orders, fills, and cancels are all consumer-group reads acknowledged with `XACK`, so a crashed service resumes exactly where it left off instead of dropping messages.
- **At-least-once order delivery** — an order is committed to Postgres *before* it's published to Redis. If the publish fails, retries kick in, and a periodic reconciliation sweep republishes anything that still didn't get through.
- **Idempotent settlement** — fills are keyed by their Redis stream message ID, so a redelivered fill after a crash is a no-op (unique-constraint hit) instead of double-settling a trade.
- **Live order book, fills & chart** — WebSocket fan-out of fills; candles are fetched straight from Bybit's public REST API in the browser, not proxied through the backend.
- **JWT auth**, paper-trading balances via an on-ramp endpoint, and an admin-gated endpoint for adding new markets.

## Architecture

Every service is a small, single-purpose Bun process. Nothing talks to another service directly — they only read and write Redis Streams, with Postgres as the durable record behind them.

```
Browser
  │  REST: signup/signin, place/cancel order, balances, markets
  ▼
apps/backend (Express) ───────────────────────────► Postgres (Neon)
  │  order committed to Postgres first, then           orders · balances
  │  XADD "orders" (retried; reconciled if it fails)    positions · fills
  ▼
Redis Stream "orders"  (consumer group: engine-group)
  ▼
apps/matching-engine
  in-memory book, price/time priority, self-trade prevention
  ├─ XADD "fills"          → every trade
  ├─ XADD "cancels"        → explicit cancels + unfilled market-order remainder
  └─ XADD "book-updates"   → full book snapshot, after every processed message
        │                        │                          │
        ▼                        ▼                          ▼
  "fills" stream          "cancels" stream           "book-updates" stream
   ├─► apps/db-worker ◄───────────┘                          │
   │   (settle-group) creates Fill rows, updates                       ▼
   │   Order.filledQty/status, updates Position          apps/snapshot-worker
   │   (weighted-avg entry); releases locked margin        writes Redis key
   │   on cancels. Idempotent via stream message ID.       orderbook:snapshot:<marketId>
   │                                                                │
   ├─► apps/mark-price-service                                     │ read on boot by
   │   (markprice-group) tracks last trade price,                  │ matching-engine (recovery)
   │   runs the 1s liquidation sweep, force-closes                 │ and by backend for
   │   positions straight in Postgres                              │ GET /api/orderbook/:id
   │                                                                ▼
   └─► apps/ws-server (ws-group)
       rebroadcasts fills over WebSocket ──► Browser (live fills, book, chart)
```

## Order lifecycle

1. `POST /api/order` locks margin and writes the order to Postgres in one transaction (`status: OPEN`).
2. It's published to the `orders` stream; on publish failure it's retried a few times, and a background sweep republishes anything still stuck.
3. `matching-engine` reads `orders` (consumer group `engine-group`), matches it against the in-memory book, and for an unfilled market order cancels the remainder instead of resting it.
4. Trades go to `fills`, cancellations/unfilled remainders go to `cancels`, and the updated book goes to `book-updates` — each acknowledged only after the in-memory match completes.
5. Three consumers fan out independently from `fills`/`cancels`: `db-worker` settles trades into Postgres, `mark-price-service` updates mark price and runs liquidations, and `ws-server` pushes the trade to connected browsers.
6. `snapshot-worker` persists the book from `book-updates` so it survives a `matching-engine` restart and can be served directly via `GET /api/orderbook/:marketId`.

## Tech stack

**Runtime & data** — [Bun](https://bun.com), PostgreSQL ([Neon](https://neon.tech)) + Prisma, Redis Streams (consumer groups)
**Backend services** — Express (REST API), plain Bun processes for matching engine / workers, `jsonwebtoken` + `bcrypt` for auth
**Frontend** — React 19, Tailwind CSS 4, shadcn/ui + Radix, served via Bun's native HTML imports (no Vite/Next.js)
**Infra** — Turborepo workspaces, deployed on Render

## Project layout

```
.
├── apps/
│   ├── backend/              # Express REST API — auth, orders, balances, markets
│   ├── matching-engine/      # In-memory order book + matcher, consumes "orders"
│   │   ├── src/book.ts       # Book state: rest/remove orders, snapshot restore
│   │   └── helper/helper.ts  # Price/time-priority matching, self-trade prevention
│   ├── db-worker/            # Settles fills + cancels into Postgres, idempotently
│   ├── mark-price-service/   # Mark price tracking + liquidation sweep
│   ├── snapshot-worker/      # Persists book snapshots for crash recovery
│   ├── ws-server/            # Bun WebSocket server, fans out fills
│   └── web/                  # Trading UI (React + Tailwind + shadcn, Bun-served)
│       └── src/components/   # Trade, OrderForm, OrderBook, PriceChart, Wallet, ...
└── packages/
    └── db/                   # Shared Prisma schema/client (@repo/db)
```

## Getting started

### Prerequisites

- [Bun](https://bun.com) v1.3+
- PostgreSQL (a [Neon](https://neon.tech) connection string works out of the box)
- Redis running locally, or a `REDIS_URL` pointing elsewhere
  ```bash
  brew install redis && brew services start redis
  # or
  docker run -p 6379:6379 -d redis:7
  ```

### 1. Install & configure

```bash
bun install
```

Set env vars per app (`.env` files, auto-loaded by Bun — no `dotenv` needed):

| App | Required vars |
|---|---|
| `apps/backend` | `DATABASE_URL`, `JWT_SECRET`, `ADMIN_SECRET` |
| `apps/db-worker` | `DATABASE_URL` |
| `apps/mark-price-service` | `DATABASE_URL` |
| `packages/db` | `DATABASE_URL` |
| all services | `REDIS_URL` (defaults to local Redis if unset) |

### 2. Migrate the database

```bash
cd packages/db && bun --bun run prisma migrate deploy
```

### 3. Run everything

```bash
bun run dev   # runs every app in the monorepo via Turborepo
```

Or run a single service directly, e.g. `bun --hot ./index.ts` from inside `apps/matching-engine`.

## API reference

All authenticated routes take a JWT from `/api/signin` as a bearer token.

| Method & path | Auth | Body / params | Notes |
|---|---|---|---|
| `POST /api/signup` | — | `username`, `password` | |
| `POST /api/signin` | — | `username`, `password` | Returns a JWT |
| `GET /api/markets` | — | — | Public list of tradable markets |
| `POST /api/admin/market` | admin secret header | `slug`, `imageUrl` | Adds a new market |
| `POST /api/on-ramp` | JWT | `amount` | Credits paper-trading USD balance |
| `GET /api/balance` | JWT | — | Current available/locked balance |
| `POST /api/order` | JWT | `market`, `side`, `OrderType`, `price?`, `qty`, `leverage` | Locks margin, commits order, publishes to `orders` |
| `GET /api/orders` | JWT | — | All orders for the caller |
| `DELETE /api/order/:id` | JWT | — | Cancels an `OPEN`/`PARTIALLY_FILLED` order |
| `GET /api/position` | JWT | — | Open positions for the caller |
| `GET /api/orderbook/:marketId` | — | — | Live bids/asks/last-trade-price from the snapshot |

### WebSocket — fills feed

Connect to the `ws-server` port; every fill from the `fills` stream is rebroadcast to all connected clients as it happens.

## Data model

```ts
type Order = {
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  price: string | null;      // null for market orders
  qty: string;
  leverage: number;
  initialMargin: string;
  filledQty: string;
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
  eventPublished: boolean;   // has this reached the matching engine yet?
};

type Position = {
  side: "LONG" | "SHORT";
  qty: string;
  entryPrice: string;        // weighted average across fills
  margin: string;
};

type Fill = {
  price: string;
  qty: string;
  maker_order_id: string;
  taker_order_id: string;
};
```
