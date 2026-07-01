import { useEffect, useMemo, useState } from "react";
import type { Balance, Market, Side, OrderType } from "../types";
import { placeOrder } from "../api";
import { useToast } from "../state";
import { num } from "../format";

export function OrderForm({
  market,
  lastPrice,
  balance,
  onPlaced,
}: {
  market: Market | null;
  lastPrice: number | undefined;
  balance: Balance | null;
  onPlaced: () => void;
}) {
  const { push } = useToast();
  const [side, setSide] = useState<Side>("BUY");
  const [type, setType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [busy, setBusy] = useState(false);

  // Prefill limit price from last trade when the market changes / first tick.
  useEffect(() => {
    if (type === "LIMIT" && !price && lastPrice) setPrice(String(lastPrice));
  }, [lastPrice, type]); // eslint-disable-line

  // Market orders have no real price; the backend still needs one to reserve
  // margin, so we send the last trade price as the estimate.
  const effPrice = type === "MARKET" ? lastPrice ?? 0 : Number(price);
  const available = Number(balance?.available ?? 0);

  const margin = useMemo(() => {
    const q = Number(qty);
    if (!effPrice || !q || !leverage) return 0;
    return (effPrice * q) / leverage;
  }, [effPrice, qty, leverage]);

  const notional = (effPrice || 0) * (Number(qty) || 0);
  const insufficient = margin > available + 1e-9;
  const canSubmit =
    !!market && Number(qty) > 0 && effPrice > 0 && !insufficient && !busy;

  async function submit() {
    if (!market) return;
    setBusy(true);
    try {
      await placeOrder({
        market: market.id,
        side,
        price: String(effPrice),
        qty,
        OrderType: type,
        leverage,
      });
      push("ok", `${type} ${side} ${qty} placed`);
      setQty("");
      onPlaced();
    } catch (e: any) {
      push("err", errText(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="orderpanel">
      <div className="seg bs">
        <button className={"buy" + (side === "BUY" ? " on" : "")} onClick={() => setSide("BUY")}>
          Buy / Long
        </button>
        <button className={"sell" + (side === "SELL" ? " on" : "")} onClick={() => setSide("SELL")}>
          Sell / Short
        </button>
      </div>

      <div className="seg">
        <button className={type === "LIMIT" ? "on" : ""} onClick={() => setType("LIMIT")}>
          Limit
        </button>
        <button className={type === "MARKET" ? "on" : ""} onClick={() => setType("MARKET")}>
          Market
        </button>
      </div>

      <div className="field">
        <label>
          <span>Price (USD)</span>
          {type === "MARKET" && <span className="muted">est. from last</span>}
        </label>
        <div className="input">
          <input
            className="mono"
            inputMode="decimal"
            placeholder="0.00"
            disabled={type === "MARKET"}
            value={type === "MARKET" ? (lastPrice ? String(lastPrice) : "") : price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <span className="suffix">USD</span>
        </div>
      </div>

      <div className="field">
        <label>Quantity</label>
        <div className="input">
          <input
            className="mono"
            inputMode="decimal"
            placeholder="0.00"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <span className="suffix">{market?.slug ?? "—"}</span>
        </div>
      </div>

      <div className="field">
        <div className="lev">
          <label style={{ margin: 0 }}>Leverage</label>
          <b className="mono">{leverage}×</b>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="kv"><span>Order value</span><b>{num(notional)} USD</b></div>
        <div className="kv"><span>Required margin</span><b>{num(margin)} USD</b></div>
        <div className="kv">
          <span>Available</span>
          <b className={insufficient ? "down" : ""}>{num(available)} USD</b>
        </div>
      </div>

      <button
        className={"bigbtn " + (side === "BUY" ? "buy" : "sell")}
        disabled={!canSubmit}
        onClick={submit}
      >
        {!market
          ? "Select a market"
          : insufficient
          ? "Insufficient margin"
          : busy
          ? "Placing…"
          : side === "BUY"
          ? "Buy / Long"
          : "Sell / Short"}
      </button>

      <p className="note">
        Margin = price × qty ÷ leverage, locked on placement and reconciled on fill.
        Market orders fill against the book at any price; any unfilled remainder is
        cancelled and its margin refunded.
      </p>
    </div>
  );
}

function errText(code: string): string {
  switch (code) {
    case "NOT_ENOUGH_BALANCE": return "Not enough balance";
    case "INVALID_MARKET": return "Unknown market";
    case "BALANCE_NOT_FOUND":
    case "BALANACE_NOT_FOUND": return "Deposit first";
    case "INVALID_DATA": return "Check the order fields";
    default: return code;
  }
}
