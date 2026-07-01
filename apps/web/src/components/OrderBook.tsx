import { useEffect, useRef, useState } from "react";
import type { BookLevel } from "../types";
import { num } from "../format";

type View = "both" | "bids" | "asks";
const TICKS = [0.01, 0.1, 1, 10];

// Live order book streamed from Binance's public depth feed, styled to match the
// Binance book: Price · Amount · Total columns, per-level depth bars, view-mode
// icons, tick-size aggregation and a large directional mid price.
const ROW_H = 22; // must match .ob-row height in CSS

export function OrderBook({ symbol }: { symbol: string }) {
  const [bids, setBids] = useState<BookLevel[]>([]);
  const [asks, setAsks] = useState<BookLevel[]>([]);
  const [view, setView] = useState<View>("both");
  const [tick, setTick] = useState(0.01);
  const prevMid = useRef(0);

  // measure each side's flex height → render exactly the whole rows that fit
  const asksRef = useRef<HTMLDivElement>(null);
  const bidsRef = useRef<HTMLDivElement>(null);
  const [asksH, setAsksH] = useState(280);
  const [bidsH, setBidsH] = useState(280);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === asksRef.current) setAsksH(e.contentRect.height);
        if (e.target === bidsRef.current) setBidsH(e.contentRect.height);
      }
    });
    if (asksRef.current) ro.observe(asksRef.current);
    if (bidsRef.current) ro.observe(bidsRef.current);
    return () => ro.disconnect();
  }, [view]);

  useEffect(() => {
    if (!symbol) { setBids([]); setAsks([]); return; }
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const map = (rows: [string, string][]): BookLevel[] =>
      rows.map(([p, q]) => ({ price: +p, qty: +q })).filter((l) => l.qty > 0);
    const connect = () => {
      ws = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@depth20@100ms`);
      ws.onclose = () => { if (alive) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        if (!alive) return;
        let d: any;
        try { d = JSON.parse(ev.data); } catch { return; }
        if (d.bids) setBids(map(d.bids));
        if (d.asks) setAsks(map(d.asks));
      };
    };
    connect();
    return () => { alive = false; if (retry) clearTimeout(retry); ws?.close(); };
  }, [symbol]);

  // aggregate to the chosen tick size (Binance "0.01 ▼" grouping)
  const aggregate = (rows: BookLevel[], isAsk: boolean): BookLevel[] => {
    if (tick <= 0.01) return rows;
    const m = new Map<number, number>();
    for (const l of rows) {
      const key = isAsk ? Math.ceil(l.price / tick) : Math.floor(l.price / tick);
      m.set(key, (m.get(key) ?? 0) + l.qty);
    }
    const out = [...m.entries()].map(([k, qty]) => ({ price: k * tick, qty }));
    out.sort((a, b) => (isAsk ? a.price - b.price : b.price - a.price));
    return out;
  };

  const asksRows = Math.max(1, Math.floor(asksH / ROW_H));
  const bidsRows = Math.max(1, Math.floor(bidsH / ROW_H));
  const asksShow = aggregate(asks, true).slice(0, asksRows);   // ascending (best first)
  const bidsShow = aggregate(bids, false).slice(0, bidsRows);  // descending (best first)
  const maxQty = Math.max(1, ...asksShow.map((l) => l.qty), ...bidsShow.map((l) => l.qty));
  const topAsks = asksShow.slice().reverse(); // worst→best, best sits by the spread

  const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : 0;
  const up = mid >= prevMid.current;
  if (mid) prevMid.current = mid;

  return (
    <div className="orderbook">
      <div className="ob-head">
        <span>Order Book</span>
        <span className="muted">···</span>
      </div>

      <div className="ob-tools">
        <div className="ob-views">
          <button className={view === "both" ? "on" : ""} onClick={() => setView("both")} title="Both"><i className="ic both" /></button>
          <button className={view === "bids" ? "on" : ""} onClick={() => setView("bids")} title="Bids"><i className="ic bids" /></button>
          <button className={view === "asks" ? "on" : ""} onClick={() => setView("asks")} title="Asks"><i className="ic asks" /></button>
        </div>
        <select className="ob-tick" value={tick} onChange={(e) => setTick(Number(e.target.value))}>
          {TICKS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="ob-cols">
        <span>Price (USDT)</span>
        <span className="r">Amount</span>
        <span className="r">Total</span>
      </div>

      {view !== "bids" && (
        <div className="ob-side asks" ref={asksRef}>
          {topAsks.length ? topAsks.map((l, i) => <Row key={"a" + i} l={l} max={maxQty} side="ask" />)
            : <div className="ob-empty">…</div>}
        </div>
      )}

      <div className={"ob-mid " + (up ? "up" : "down")}>
        <span className="px">{mid ? num(mid) : "—"}</span>
        <span className="arrow">{mid ? (up ? "↑" : "↓") : ""}</span>
        <span className="muted">${mid ? num(mid) : "—"}</span>
        <span className="chev">›</span>
      </div>

      {view !== "asks" && (
        <div className="ob-side bids" ref={bidsRef}>
          {bidsShow.length ? bidsShow.map((l, i) => <Row key={"b" + i} l={l} max={maxQty} side="bid" />)
            : <div className="ob-empty">…</div>}
        </div>
      )}
    </div>
  );
}

function abbrev(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(6);
}

function Row({ l, max, side }: { l: BookLevel; max: number; side: "bid" | "ask" }) {
  const pct = Math.min(100, (l.qty / max) * 100);
  return (
    <div className="ob-row">
      <div className={"ob-bar " + side} style={{ width: pct + "%" }} />
      <span className={side === "ask" ? "down" : "up"}>{num(l.price)}</span>
      <span className="r amt">{l.qty.toFixed(5)}</span>
      <span className="r tot">{abbrev(l.price * l.qty)}</span>
    </div>
  );
}
