import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { useFills, useMarkets } from "../state";
import { getOrders, getPositions, getBalance, binanceSymbol } from "../api";
import type { Order, Position, Balance } from "../types";
import { num, compact } from "../format";
import { PriceChart } from "./PriceChart";
import { OrderBook } from "./OrderBook";
import { OrderForm } from "./OrderForm";
import { Positions, OpenOrders, OrderHistory, Trades } from "./Tables";
import { AddMarket } from "./AddMarket";

type BottomTab = "positions" | "open" | "trades" | "history";
type Split = { symW: number; obW: number; orderW: number; bottomH: number };

const TIMEFRAMES = ["15m", "1h", "4h", "1d"];
const LAYOUT_KEY = "perp.split.v1";
const DEFAULT: Split = { symW: 196, obW: 284, orderW: 262, bottomH: 170 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Trade() {
  const { markets } = useMarkets();
  const { lastPrice, trades } = useFills();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tf, setTf] = useState("15m");
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [tab, setTab] = useState<BottomTab>("positions");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [ticker, setTicker] = useState<{ last: number; pct: number; high: number; low: number; vol: number } | null>(null);
  const [chartMode, setChartMode] = useState<"candle" | "line">("candle");

  // ---- resizable split layout: dividers redistribute space between neighbours ----
  const [split, setSplit] = useState<Split>(() => {
    try {
      const s = localStorage.getItem(LAYOUT_KEY);
      if (s) return { ...DEFAULT, ...JSON.parse(s) };
    } catch { /* ignore */ }
    return DEFAULT;
  });
  useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(split)); }, [split]);

  useEffect(() => {
    if (!markets.length) { setSelectedId(null); return; }
    if (!selectedId || !markets.some((m) => m.id === selectedId)) setSelectedId(markets[0]!.id);
  }, [markets, selectedId]);

  const refresh = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([getOrders(), getPositions()]);
      setOrders(o.data);
      setPositions(p.data);
    } catch { /* transient */ }
    try {
      const b = await getBalance();
      setBalance(b.data);
    } catch { setBalance(null); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const market = markets.find((m) => m.id === selectedId) ?? null;
  const last = selectedId ? lastPrice[selectedId] : undefined;
  const symbol = market ? binanceSymbol(market.slug) : "";

  useEffect(() => {
    if (!symbol) { setTicker(null); return; }
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@ticker`);
      ws.onclose = () => { if (alive) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        if (!alive) return;
        try {
          const d = JSON.parse(ev.data);
          setTicker({ last: +d.c, pct: +d.P, high: +d.h, low: +d.l, vol: +d.q });
        } catch { /* ignore */ }
      };
    };
    connect();
    return () => { alive = false; if (retry) clearTimeout(retry); ws?.close(); };
  }, [symbol]);

  const open = orders.filter((o) => o.status === "OPEN" || o.status === "PARTIALLY_FILLED");
  const filtered = markets.filter((m) => m.slug.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="tlayout">
      {/* ---- market stats bar (full width) ---- */}
      <div className="pcard" style={{ flex: "none", height: 92 }}>
        <div className="panel-head"><span className="panel-title">Market</span></div>
        <div className="panel-body">
          <div className="marketbar">
            <div className="sym">
              <b>{market ? market.slug : "Select market"}</b>
              <span>Perpetual · Binance {symbol || "—"}</span>
            </div>
            <div className={"last " + (ticker ? (ticker.pct >= 0 ? "up" : "down") : "")}>
              {ticker ? num(ticker.last) : last ? num(last) : "—"}
            </div>
            <div className="stat">
              <span className="k">24h Change</span>
              <span className={"v " + (ticker ? (ticker.pct >= 0 ? "up" : "down") : "na")}>
                {ticker ? `${ticker.pct >= 0 ? "+" : ""}${ticker.pct.toFixed(2)}%` : "—"}
              </span>
            </div>
            <Stat k="24h High" v={ticker ? num(ticker.high) : undefined} />
            <Stat k="24h Low" v={ticker ? num(ticker.low) : undefined} />
            <Stat k="24h Volume" v={ticker ? compact(ticker.vol) + " USDT" : undefined} />
            <Stat k="Last (your mkt)" v={last ? num(last) : undefined} />
          </div>
        </div>
      </div>

      <div className="trow">
        {/* symbols */}
        <div className="col-fixed" style={{ width: split.symW }}>
          <div className="pcard">
            <div className="panel-head"><span className="panel-title">Markets</span></div>
            <div className="panel-body">
              <aside className="symbols">
                <div className="search">
                  <input placeholder="Search market" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="symlist">
                  {filtered.map((m) => (
                    <div key={m.id} className={"symrow" + (m.id === selectedId ? " active" : "")} onClick={() => setSelectedId(m.id)}>
                      <div className="ic">{m.imageUrl ? <img src={m.imageUrl} alt="" /> : m.slug.slice(0, 1)}</div>
                      <div className="nm">{m.slug}<small>Perp</small></div>
                      <div className="px">{lastPrice[m.id] ? compact(lastPrice[m.id]) : "—"}</div>
                    </div>
                  ))}
                  {!markets.length && <div className="empty" style={{ padding: 20 }}>No markets yet.</div>}
                  <div style={{ padding: 10 }}>
                    <button className="btn sm" style={{ width: "100%" }} onClick={() => setShowAdd(true)}>+ Add market</button>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>

        <VSplit onDelta={(dx) => setSplit((s) => ({ ...s, symW: clamp(s.symW + dx, 150, 420) }))} />

        {/* chart + bottom (flex column) */}
        <div className="col-flex">
          <div className="pcard">
            <div className="panel-head"><span className="panel-title">Chart</span></div>
            <div className="panel-body">
              <div className="chartwrap">
                <div className="chart-head">
                  <span>{market ? market.slug : "—"}</span>
                  {market && <span className="muted">· Binance {symbol}</span>}
                  {market && (
                    <div className="ctoggle">
                      <button className={chartMode === "candle" ? "on" : ""} onClick={() => setChartMode("candle")} title="Candles">▮</button>
                      <button className={chartMode === "line" ? "on" : ""} onClick={() => setChartMode("line")} title="Line">〜</button>
                    </div>
                  )}
                  <div className="spacer" />
                  <div className="tf">
                    {TIMEFRAMES.map((t) => (
                      <button key={t} className={t === tf ? "on" : ""} onClick={() => setTf(t)}>{t}</button>
                    ))}
                  </div>
                </div>
                {market ? (
                  <PriceChart symbol={symbol} interval={tf} mode={chartMode} />
                ) : (
                  <div className="chart-body"><div className="chart-empty">Select a market</div></div>
                )}
              </div>
            </div>
          </div>

          <HSplit onDelta={(dy) => setSplit((s) => ({ ...s, bottomH: clamp(s.bottomH - dy, 120, 480) }))} />

          <div className="pcard" style={{ flex: "none", height: split.bottomH }}>
            <div className="panel-head"><span className="panel-title">Positions / Orders</span></div>
            <div className="panel-body">
              <div className="bottom">
                <div className="tabs">
                  <button className={tab === "positions" ? "on" : ""} onClick={() => setTab("positions")}>Positions <span className="count">{positions.length}</span></button>
                  <button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>Open Orders <span className="count">{open.length}</span></button>
                  <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")}>Market Trades</button>
                  <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Order History</button>
                </div>
                {tab === "positions" && <Positions positions={positions} markets={markets} lastPrice={lastPrice} />}
                {tab === "open" && <OpenOrders orders={orders} markets={markets} onChange={refresh} />}
                {tab === "trades" && <Trades trades={trades} marketId={selectedId} />}
                {tab === "history" && <OrderHistory orders={orders} markets={markets} />}
              </div>
            </div>
          </div>
        </div>

        <VSplit onDelta={(dx) => setSplit((s) => ({ ...s, obW: clamp(s.obW - dx, 190, 520) }))} />

        {/* order book */}
        <div className="col-fixed" style={{ width: split.obW }}>
          <div className="pcard">
            <div className="panel-head"><span className="panel-title">Order Book</span></div>
            <div className="panel-body"><OrderBook symbol={symbol} /></div>
          </div>
        </div>

        <VSplit onDelta={(dx) => setSplit((s) => ({ ...s, obW: clamp(s.obW + dx, 190, 520), orderW: clamp(s.orderW - dx, 190, 460) }))} />

        {/* order panel */}
        <div className="col-fixed" style={{ width: split.orderW }}>
          <div className="pcard">
            <div className="panel-head"><span className="panel-title">Buy / Sell</span></div>
            <div className="panel-body"><OrderForm market={market} lastPrice={last} balance={balance} onPlaced={refresh} /></div>
          </div>
        </div>
      </div>

      <button className="layout-reset btn sm" onClick={() => setSplit(DEFAULT)}>⟲ Reset layout</button>

      {showAdd && <AddMarket onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// vertical divider — drag left/right, reports horizontal delta since last move
function VSplit({ onDelta }: { onDelta: (dx: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className="vdiv"
      onPointerDown={(e: React.PointerEvent) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); last.current = e.clientX; }}
      onPointerMove={(e: React.PointerEvent) => { if (last.current == null) return; const dx = e.clientX - last.current; last.current = e.clientX; onDelta(dx); }}
      onPointerUp={(e: React.PointerEvent) => { last.current = null; try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ } }}
    />
  );
}

// horizontal divider — drag up/down, reports vertical delta since last move
function HSplit({ onDelta }: { onDelta: (dy: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className="hdiv"
      onPointerDown={(e: React.PointerEvent) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); last.current = e.clientY; }}
      onPointerMove={(e: React.PointerEvent) => { if (last.current == null) return; const dy = e.clientY - last.current; last.current = e.clientY; onDelta(dy); }}
      onPointerUp={(e: React.PointerEvent) => { last.current = null; try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ } }}
    />
  );
}

function Stat({ k, v, note }: { k: string; v?: string; note?: string }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className={"v" + (v ? "" : " na")}>{v ?? note ?? "—"}</span>
    </div>
  );
}
