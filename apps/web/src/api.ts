import type { Balance, Order, Position, Market, Side, OrderType, OrderBook, Candle } from "./types";

// The backend's authMiddleware reads the *raw* token from the Authorization
// header (no "Bearer " prefix), so we send it exactly as issued.
const TOKEN_KEY = "perp.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Json = Record<string, unknown>;

async function request<T>(
  method: string,
  path: string,
  body?: Json,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["authorization"] = token;
  if (body) headers["content-type"] = "application/json";
  // explicit per-call headers win (e.g. the admin secret for /admin/market)
  Object.assign(headers, extraHeaders);

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok || (data && data.success === false)) {
    const msg = (data && (data.error || data.msg)) || `HTTP ${res.status}`;
    throw new ApiError(String(msg), res.status);
  }
  return data as T;
}

// ---- auth ----
export function signup(username: string, password: string) {
  return request<{ success: boolean; id: string }>("POST", "/signup", { username, password });
}
export function signin(username: string, password: string) {
  return request<{ success: boolean; data: string; msg: string }>("POST", "/signin", {
    username,
    password,
  });
}

// ---- wallet ----
export function getBalance() {
  return request<{ success: boolean; data: Balance }>("GET", "/balance");
}
export function onRamp(amount: string, asset = "USD") {
  return request<{ success: boolean; msg: string }>("POST", "/on-ramp", { amount, asset });
}

// ---- trading ----
export function placeOrder(input: {
  market: string;
  side: Side;
  price: string;
  qty: string;
  OrderType: OrderType;
  leverage: number;
}) {
  return request<{ success: boolean; data: Order }>("POST", "/order", input);
}
export function getOrders() {
  return request<{ success: boolean; data: Order[] }>("GET", "/orders");
}
export function cancelOrder(id: string) {
  return request<{ success: boolean; msg: string }>("DELETE", `/order/${id}`);
}
export function getPositions() {
  return request<{ success: boolean; data: Position[] }>("GET", "/position");
}
export function getOrderbook(marketId: string) {
  return request<{ success: boolean; data: OrderBook }>("GET", `/orderbook/${marketId}`);
}
export function getMarkets() {
  return request<{ success: boolean; data: Market[] }>("GET", "/markets");
}
// Fetched directly from Binance (browser → Binance), not proxied through our
// backend: Binance geo-blocks US cloud datacenter IPs (incl. Render), so a
// backend-side fetch hangs ~35s then 502s. The browser's IP isn't blocked —
// same reason the live WebSocket stream in PriceChart connects straight to
// Binance instead of through us. Binance's REST API sends
// access-control-allow-origin: * so this works cross-origin.
export async function getKlines(
  symbol: string,
  interval: string,
  limit = 200,
): Promise<{ success: boolean; data: Candle[] }> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new ApiError("BINANCE_REJECTED", r.status);
  const raw = (await r.json()) as any[];
  const data: Candle[] = raw.map((k) => ({
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
  return { success: true, data };
}

// Map a market slug (e.g. "BTC-PERP") to a Binance spot symbol ("BTCUSDT").
export function binanceSymbol(slug: string): string {
  const base = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(PERP|USDT|USDC|USD)$/g, "");
  return base ? `${base}USDT` : "BTCUSDT";
}

// ---- admin (market creation; needs the ADMIN_SECRET) ----
export function createMarket(slug: string, imageUrl: string, adminSecret: string) {
  return request<{ success: boolean; data: Market }>(
    "POST",
    "/admin/market",
    { slug, imageUrl },
    { authorization: adminSecret },
  );
}
