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
export const SESSION_EXPIRED = "perp:session-expired";

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

  // Only authMiddleware answers 401: our stored token is missing/expired/invalid.
  // Drop it and let AuthProvider fall back to guest mode instead of every
  // poll failing forever.
  if (res.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event(SESSION_EXPIRED));
  }

  if (!res.ok || (data && data.success === false)) {
    const msg = (data && (data.error || data.msg)) || `HTTP ${res.status}`;
    throw new ApiError(String(msg), res.status);
  }
  return data as T;
}

// ---- auth ----
export function signup(username: string, password: string) {
  return request<{ success: boolean; id: string; data: string }>("POST", "/signup", { username, password });
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
// Fetched directly from Bybit, not proxied through our backend: Bybit is
// legally required to geo-block US IPs (CFTC settlement), and our backend
// runs on Render in Oregon, so it gets rejected the same way Binance's REST
// endpoint blocks it too (for an unrelated reason — anti-cloud-IP policy).
// The browser isn't in the US, and Bybit's kline endpoint sends CORS headers
// that explicitly allow being called from arbitrary origins.
const BYBIT_INTERVAL: Record<string, string> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "6h": "360", "8h": "360", "12h": "720",
  "1d": "D", "3d": "D", "1w": "W", "1M": "M",
};
export async function getKlines(
  symbol: string,
  interval: string,
  limit = 200,
): Promise<{ success: boolean; data: Candle[] }> {
  const bybitInterval = BYBIT_INTERVAL[interval] ?? "15";
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${bybitInterval}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new ApiError("BYBIT_REJECTED", r.status);
  const body = (await r.json()) as any;
  const list = (body?.result?.list ?? []) as any[];
  // Bybit returns newest-first; the chart wants oldest-first.
  const data: Candle[] = list
    .map((k) => ({
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    }))
    .reverse();
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
export function deleteMarket(id: string, adminSecret: string) {
  return request<{ success: boolean }>("DELETE", `/admin/market/${id}`, undefined, {
    authorization: adminSecret,
  });
}

// Admin tools (create/delete market) are only rendered at ?admin. This is just
// to keep them out of regular users' way — the backend enforces ADMIN_SECRET.
export const isAdminView = new URLSearchParams(location.search).has("admin");
