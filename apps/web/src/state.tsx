import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import type { Fill, Market } from "./types";
import { getToken, setToken, clearToken } from "./api";

/* ------------------------------------------------------------------ auth */

type AuthCtx = {
  token: string | null;
  signedIn: boolean;
  login: (token: string) => void;
  logout: () => void;
};
const AuthContext = createContext<AuthCtx | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken());
  const login = useCallback((t: string) => {
    setToken(t);
    setTok(t);
  }, []);
  const logout = useCallback(() => {
    clearToken();
    setTok(null);
  }, []);
  return (
    <AuthContext.Provider value={{ token, signedIn: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}

/* ----------------------------------------------------------------- toasts */

type Toast = { id: number; kind: "ok" | "err"; msg: string };
type ToastCtx = { push: (kind: "ok" | "err", msg: string) => void; toasts: Toast[] };
const ToastContext = createContext<ToastCtx | null>(null);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: "ok" | "err", msg: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return <ToastContext.Provider value={{ push, toasts }}>{children}</ToastContext.Provider>;
}
export function useToast() {
  const c = useContext(ToastContext);
  if (!c) throw new Error("useToast outside provider");
  return c;
}

/* ----------------------------------------------------------- markets store */
// No backend list endpoint exists, so the set of known markets is kept locally
// (seeded when you create one via admin, or add an existing id by hand).

const MARKETS_KEY = "perp.markets";
type MarketsCtx = {
  markets: Market[];
  add: (m: Market) => void;
  remove: (id: string) => void;
};
const MarketsContext = createContext<MarketsCtx | null>(null);

function MarketsProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<Market[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(MARKETS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem(MARKETS_KEY, JSON.stringify(markets));
  }, [markets]);

  const add = useCallback((m: Market) => {
    setMarkets((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
  }, []);
  const remove = useCallback((id: string) => {
    setMarkets((list) => list.filter((x) => x.id !== id));
  }, []);
  return (
    <MarketsContext.Provider value={{ markets, add, remove }}>{children}</MarketsContext.Provider>
  );
}
export function useMarkets() {
  const c = useContext(MarketsContext);
  if (!c) throw new Error("useMarkets outside provider");
  return c;
}

/* ------------------------------------------------------------- fills feed */
// One app-wide WebSocket to the ws-server. It broadcasts every trade; we derive
// last price, a rolling price series (for the chart) and a recent-trades list.

const MAX_TRADES = 60;
const MAX_POINTS = 240;
export type PricePoint = { t: number; p: number };

type FillsCtx = {
  connected: boolean;
  trades: Fill[];
  lastPrice: Record<string, number>;
  series: Record<string, PricePoint[]>;
};
const FillsContext = createContext<FillsCtx | null>(null);

function FillsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [trades, setTrades] = useState<Fill[]>([]);
  const [lastPrice, setLastPrice] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<Record<string, PricePoint[]>>({});

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const url = `ws://${location.hostname}:8080`;
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        let fill: Fill;
        try {
          fill = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!fill || !fill.marketId) return;
        const p = Number(fill.price);
        setTrades((t) => [fill, ...t].slice(0, MAX_TRADES));
        if (isFinite(p) && p > 0) {
          setLastPrice((m) => ({ ...m, [fill.marketId]: p }));
          setSeries((s) => {
            const prev = s[fill.marketId] ?? [];
            const next = [...prev, { t: Date.now(), p }].slice(-MAX_POINTS);
            return { ...s, [fill.marketId]: next };
          });
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return (
    <FillsContext.Provider value={{ connected, trades, lastPrice, series }}>
      {children}
    </FillsContext.Provider>
  );
}
export function useFills() {
  const c = useContext(FillsContext);
  if (!c) throw new Error("useFills outside provider");
  return c;
}

/* ---------------------------------------------------------- root provider */

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <MarketsProvider>
          <FillsProvider>{children}</FillsProvider>
        </MarketsProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
