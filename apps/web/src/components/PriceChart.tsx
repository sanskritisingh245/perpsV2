import { useEffect, useRef, useState } from "react";
import type { Candle } from "../types";
import { getKlines } from "../api";
import { num } from "../format";

const UP = "#2ebd85";
const DOWN = "#f6465d";
const ACCENT = "#fcd535";
const RANGE_LERP = 0.08;  // y-axis eases (8%/frame), snaps outward
const CANDLE_LERP = 0.22; // forming candle eases toward each live tick
const ZOOM_LERP = 0.2;    // visible-count eases when zooming → candles expand smoothly
const MIN_VIS = 12;       // most zoomed-in
const DEFAULT_VIS = 60;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Candlestick / line chart on live Binance data (REST seed + WebSocket stream).
// The y-range, the forming candle, and the zoom level are all animated frame by
// frame (Liveline-style lerp) so the chart breathes and candles expand smoothly.
export function PriceChart({ symbol, interval, mode }: { symbol: string; interval: string; mode: "candle" | "line" }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 360 });
  const [candles, setCandles] = useState<Candle[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [hover, setHover] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [targetVis, setTargetVis] = useState(DEFAULT_VIS); // how many candles to show

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // 1) REST seed history. 2) WebSocket streams live candle updates.
  useEffect(() => {
    let alive = true;
    setState("loading");
    setLive(false);

    (async () => {
      try {
        const { data } = await getKlines(symbol, interval, 150);
        if (!alive) return;
        setCandles(data);
        setState(data.length ? "ok" : "error");
      } catch {
        if (alive) setState("error");
      }
    })();

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_${interval}`);
      ws.onopen = () => alive && setLive(true);
      ws.onclose = () => { if (alive) { setLive(false); retry = setTimeout(connect, 2000); } };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        if (!alive) return;
        let k: any;
        try { k = JSON.parse(ev.data).k; } catch { return; }
        if (!k) return;
        const c: Candle = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
        setCandles((prev) => {
          const arr = prev.slice();
          const lastC = arr[arr.length - 1];
          if (lastC && lastC.t === c.t) arr[arr.length - 1] = c;
          else if (!lastC || c.t > lastC.t) { arr.push(c); if (arr.length > 200) arr.shift(); }
          return arr;
        });
      };
    };
    connect();

    return () => { alive = false; if (retry) clearTimeout(retry); ws?.close(); };
  }, [symbol, interval]);

  // ---- zoom: scroll over the chart to expand / contract candles ----
  const maxVisRef = useRef(candles.length || DEFAULT_VIS);
  maxVisRef.current = Math.max(MIN_VIS, candles.length || DEFAULT_VIS);
  const zoom = (factor: number) =>
    setTargetVis((v) => clamp(Math.round(v * factor), MIN_VIS, maxVisRef.current));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 0.85 : 1.18); // up = zoom in (fewer, wider candles)
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- animation loop: lerp y-range, forming candle, and zoom (visible count) ----
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const targetVisRef = useRef(targetVis);
  targetVisRef.current = targetVis;
  const anim = useRef<{ lo: number; hi: number; last: Candle | null; vis: number }>({ lo: 0, hi: 1, last: null, vis: 0 });
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const cs = candlesRef.current;
      if (cs.length >= 2) {
        const a = anim.current;
        let moved = false;

        // zoom (visible count) eases toward target
        const targetVisN = clamp(targetVisRef.current, MIN_VIS, cs.length);
        if (a.vis === 0) { a.vis = targetVisN; moved = true; }
        const nVis = lerp(a.vis, targetVisN, ZOOM_LERP);
        if (Math.abs(nVis - a.vis) > 0.02) moved = true;
        a.vis = nVis;

        // range over the visible window only (so zoom rescales price too)
        const visCount = Math.min(cs.length, Math.ceil(a.vis) + 1);
        const visible = cs.slice(-visCount);
        const targetLo = Math.min(...visible.map((c) => c.l));
        const targetHi = Math.max(...visible.map((c) => c.h));
        const eps = (a.hi - a.lo || 1) * 2e-4;

        if (!a.last) {
          a.lo = targetLo; a.hi = targetHi; a.last = { ...cs[cs.length - 1]! }; moved = true;
        } else {
          const nLo = targetLo < a.lo ? targetLo : lerp(a.lo, targetLo, RANGE_LERP);
          const nHi = targetHi > a.hi ? targetHi : lerp(a.hi, targetHi, RANGE_LERP);
          if (Math.abs(nLo - a.lo) > eps || Math.abs(nHi - a.hi) > eps) moved = true;
          a.lo = nLo; a.hi = nHi;

          const tl = cs[cs.length - 1]!;
          if (a.last.t !== tl.t) { a.last = { ...tl }; moved = true; }
          else {
            const o = lerp(a.last.o, tl.o, CANDLE_LERP);
            const h = lerp(a.last.h, tl.h, CANDLE_LERP);
            const l = lerp(a.last.l, tl.l, CANDLE_LERP);
            const c = lerp(a.last.c, tl.c, CANDLE_LERP);
            if (Math.abs(c - a.last.c) > eps || Math.abs(h - a.last.h) > eps || Math.abs(l - a.last.l) > eps) moved = true;
            a.last = { t: tl.t, o, h, l, c, v: tl.v };
          }
        }
        if (moved) setTick((x) => (x + 1) & 0xffff);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const { w, h } = size;
  const pad = { l: 8, r: 66, t: 14, b: 22 };
  const iw = Math.max(1, w - pad.l - pad.r);
  const ih = Math.max(1, h - pad.t - pad.b);

  const a = anim.current;
  let view: { candles: Candle[]; lo: number; hi: number; vis: number } | null = null;
  if (candles.length >= 2 && a.last && a.vis > 0) {
    const visCount = Math.min(candles.length, Math.ceil(a.vis) + 1);
    const slice = candles.slice(-visCount);
    const animated = [...slice.slice(0, -1), a.last]; // animate the forming candle
    view = { candles: animated, lo: a.lo, hi: a.hi, vis: a.vis };
  }

  return (
    <div className="chart-body" ref={box}>
      <div className="chart-live" title={live ? "Live Binance stream" : "Connecting…"}>
        <span className={"dot" + (live ? " on" : "")} /> {live ? "LIVE" : "···"}
      </div>

      {state === "error" && (
        <div className="chart-empty">
          <div>
            <div style={{ fontSize: 24, opacity: 0.4 }}>⚠️</div>
            No Binance data for <b>{symbol}</b>
            <div className="note" style={{ marginTop: 6, maxWidth: 260 }}>
              Backend offline, or the slug doesn’t map to a Binance symbol. Name
              markets like <code>BTC-PERP</code> → <code>BTCUSDT</code>.
            </div>
          </div>
        </div>
      )}

      {state === "loading" && !view && <div className="chart-empty">Loading {symbol}…</div>}

      {view && (
        <Svg
          candles={view.candles} lo={view.lo} hi={view.hi} vis={view.vis} mode={mode}
          w={w} h={h} pad={pad} iw={iw} ih={ih}
          hover={hover} setHover={setHover}
        />
      )}
    </div>
  );
}

function Svg({
  candles, lo, hi, vis, mode, w, h, pad, iw, ih, hover, setHover,
}: {
  candles: Candle[];
  lo: number; hi: number; vis: number;
  mode: "candle" | "line";
  w: number; h: number;
  pad: { l: number; r: number; t: number; b: number };
  iw: number; ih: number;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const span = hi - lo || hi || 1;
  const n = candles.length;
  const step = iw / vis;                // fractional → smooth zoom
  const bodyW = Math.max(1.5, Math.min(step * 0.72, 14));
  // anchor newest candle to the right edge; older ones extend left (clipped)
  const cx = (j: number) => pad.l + iw - step / 2 - (n - 1 - j) * step;
  const y = (p: number) => pad.t + (1 - (p - lo) / span) * ih;

  const last = candles[n - 1]!;
  const lastUp = last.c >= last.o;
  const lastY = y(last.c);

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const linePath = candles.map((c, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(c.c).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${cx(n - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${cx(0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;

  const ticks = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].filter((i) => cx(i) >= pad.l);
  const hc = hover != null && hover >= 0 && hover < n ? candles[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const j = n - 1 - Math.round((pad.l + iw - step / 2 - x) / step);
    setHover(j >= 0 && j < n ? j : null);
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="lfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.20" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </linearGradient>
        <clipPath id="plot"><rect x={pad.l} y={pad.t - 2} width={iw} height={ih + 4} /></clipPath>
      </defs>

      {grid.map((g) => {
        const gy = pad.t + g * ih;
        return (
          <g key={g}>
            <line x1={pad.l} x2={pad.l + iw} y1={gy} y2={gy} stroke="#1c232b" strokeWidth="1" />
            <text x={pad.l + iw + 5} y={gy + 3} fontSize="10" fill="#5e6673" fontFamily="ui-monospace, monospace">
              {num(hi - g * span)}
            </text>
          </g>
        );
      })}

      {ticks.map((i) => (
        <text key={i} x={cx(i)} y={h - 6} fontSize="10" fill="#5e6673" textAnchor="middle" fontFamily="ui-monospace, monospace">
          {new Date(candles[i]!.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
        </text>
      ))}

      <g clipPath="url(#plot)">
        {mode === "candle" ? (
          candles.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? UP : DOWN;
            const yo = y(c.o);
            const yc = y(c.c);
            const top = Math.min(yo, yc);
            const bh = Math.max(1, Math.abs(yc - yo));
            const x = cx(i);
            const wickW = Math.max(0.8, Math.min(bodyW * 0.18, 2));
            return (
              <g key={i}>
                <rect x={x - wickW / 2} y={y(c.h)} width={wickW} height={Math.max(1, y(c.l) - y(c.h))} fill={color} />
                <rect x={x - bodyW / 2} y={top} width={bodyW} height={bh} fill={color} rx={bodyW > 5 ? 1 : 0} />
              </g>
            );
          })
        ) : (
          <>
            <path d={areaPath} fill="url(#lfill)" />
            <path d={linePath} fill="none" stroke={ACCENT} strokeWidth="1.6" />
          </>
        )}
      </g>

      {hc && (() => {
        // drop the readout below the toolbar / LIVE badge row so it never overlaps
        const boxX = cx(hover!) > w / 2 ? pad.l + 6 : pad.l + iw - 150;
        const boxY = pad.t + 34;
        const tx = boxX + 8;
        return (
          <>
            <line x1={cx(hover!)} x2={cx(hover!)} y1={pad.t} y2={pad.t + ih} stroke="#3a4350" strokeWidth="1" strokeDasharray="3 3" />
            <rect x={boxX} y={boxY} width={144} height={56} rx={4} fill="#0b0e11" stroke="#2b3139" />
            <text x={tx} y={boxY + 16} fontSize="10" fill="#848e9c" fontFamily="ui-monospace, monospace">O {num(hc.o)}  H {num(hc.h)}</text>
            <text x={tx} y={boxY + 30} fontSize="10" fill="#848e9c" fontFamily="ui-monospace, monospace">L {num(hc.l)}  C {num(hc.c)}</text>
            <text x={tx} y={boxY + 46} fontSize="10" fill="#5e6673" fontFamily="ui-monospace, monospace">
              {new Date(hc.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
            </text>
          </>
        );
      })()}

      {/* last price marker (rides the animated close) */}
      <line x1={pad.l} x2={pad.l + iw} y1={lastY} y2={lastY} stroke={lastUp ? UP : DOWN} strokeWidth="0.5" strokeDasharray="3 3" opacity="0.8" />
      <rect x={pad.l + iw + 1} y={lastY - 8} width={pad.r - 2} height={16} rx={2} fill={lastUp ? UP : DOWN} />
      <text x={pad.l + iw + 5} y={lastY + 4} fontSize="10" fill="#0b0e11" fontFamily="ui-monospace, monospace">
        {num(last.c)}
      </text>
    </svg>
  );
}
