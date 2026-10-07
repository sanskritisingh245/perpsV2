import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { Fill, Market } from "./types";
import { getToken, setToken, clearToken, getMarkets, SESSION_EXPIRED } from "./api";

/* ------------------------------------------------------------------ auth */

// Guests can browse everything; the login modal only opens when they try to
// do something that needs an account (trade, wallet).
export type AuthMode = "in" | "up";
type AuthCtx = {
  token: string | null;
  signedIn: boolean;
  login: (token: string) => void;
  logout: () => void;
  authMode: AuthMode | null; // null = login modal closed
  openAuth: (mode?: AuthMode) => void;
  closeAuth: () => void;
};
const AuthContext = createContext<AuthCtx | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken());
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const login = useCallback((t: string) => {
    setToken(t);
    setTok(t);
    setAuthMode(null);
  }, []);
  const logout = useCallback(() => {
    clearToken();
    setTok(null);
  }, []);
  const openAuth = useCallback((mode: AuthMode = "up") => setAuthMode(mode), []);
  const closeAuth = useCallback(() => setAuthMode(null), []);

  // api.ts drops the token on a 401; mirror that here so the UI goes back to guest mode.
  useEffect(() => {
    const onExpired = () => {
      setTok(null);
      toast.error("Session expired — please sign in again");
    };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, signedIn: !!token, login, logout, authMode, openAuth, closeAuth }}
    >
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

// Toasts are rendered by Sonner (see components/ui/sonner). This just keeps the
// app's tiny push(kind, msg) API so callers don't need to know about Sonner.
type ToastCtx = { push: (kind: "ok" | "err", msg: string) => void };
const ToastContext = createContext<ToastCtx | null>(null);

function ToastProvider({ children }: { children: ReactNode }) {
  const push = useCallback((kind: "ok" | "err", msg: string) => {
    if (kind === "ok") toast.success(msg);
    else toast.error(msg);
  }, []);
  return <ToastContext.Provider value={{ push }}>{children}</ToastContext.Provider>;
}
export function useToast() {
  const c = useContext(ToastContext);
  if (!c) throw new Error("useToast outside provider");
  return c;
}

/* ----------------------------------------------------------- markets store */
// The backend's /markets is the source of truth. localStorage is only a cache
// for first paint / backend-offline; add/remove mirror successful admin calls.

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

  // Replace (not merge) so markets deleted on the backend disappear here too.
  useEffect(() => {
    getMarkets()
      .then((res) => setMarkets(res.data))
      .catch(() => { /* backend unreachable — keep the cached list */ });
  }, []);

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

    // The ws-server runs on its own host in prod, so we can't assume same-origin.
    // The web server hands back its public URL via /config; fall back to
    // same-host :8080 for local dev.
    let cachedUrl: string | null = null;
    const resolveUrl = async (): Promise<string> => {
      if (cachedUrl) return cachedUrl;
      try {
        const res = await fetch("/config");
        const cfg = await res.json();
        if (cfg?.wsUrl) return (cachedUrl = cfg.wsUrl as string);
      } catch { /* fall through to same-host default */ }
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      return (cachedUrl = `${scheme}://${location.hostname}:8080`);
    };

    const connect = async () => {
      const url = await resolveUrl();
      if (closed) return;
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
