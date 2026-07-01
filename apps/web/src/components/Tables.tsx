import type { Order, Position, Market, Fill } from "../types";
import { num, timeAgo, clockTime, shortId } from "../format";
import { cancelOrder } from "../api";
import { useToast } from "../state";

function slugOf(markets: Market[], id: string): string {
  return markets.find((m) => m.id === id)?.slug ?? shortId(id, 8);
}

/* --------------------------------------------------------------- positions */

export function Positions({
  positions,
  markets,
  lastPrice,
}: {
  positions: Position[];
  markets: Market[];
  lastPrice: Record<string, number>;
}) {
  if (!positions.length) return <Empty text="No open positions" />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Market</th><th>Side</th><th>Size</th><th>Entry</th>
            <th>Mark</th><th>Margin</th><th>Liq. price</th><th>uPnL</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const mark = lastPrice[p.marketId];
            const entry = Number(p.entryPrice);
            const qty = Number(p.qty);
            const margin = Number(p.margin);
            const liq = p.side === "LONG" ? entry - margin / qty : entry + margin / qty;
            const pnl =
              mark === undefined
                ? null
                : (p.side === "LONG" ? mark - entry : entry - mark) * qty;
            return (
              <tr key={p.id}>
                <td>{slugOf(markets, p.marketId)}</td>
                <td><span className={"badge " + p.side.toLowerCase()}>{p.side}</span></td>
                <td>{num(qty, 4)}</td>
                <td>{num(entry)}</td>
                <td>{mark === undefined ? "—" : num(mark)}</td>
                <td>{num(margin)}</td>
                <td className="down">{num(liq)}</td>
                <td className={pnl === null ? "muted" : pnl >= 0 ? "up" : "down"}>
                  {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${num(pnl)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- open orders */

export function OpenOrders({
  orders,
  markets,
  onChange,
}: {
  orders: Order[];
  markets: Market[];
  onChange: () => void;
}) {
  const { push } = useToast();
  const open = orders.filter((o) => o.status === "OPEN" || o.status === "PARTIALLY_FILLED");

  async function cancel(id: string) {
    try {
      await cancelOrder(id);
      push("ok", "Cancel requested");
      onChange();
    } catch (e: any) {
      push("err", e.message);
    }
  }

  if (!open.length) return <Empty text="No open orders" />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Time</th><th>Market</th><th>Side</th><th>Type</th>
            <th>Price</th><th>Qty</th><th>Filled</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {open.map((o) => (
            <tr key={o.id}>
              <td className="muted">{timeAgo(o.createdAt)}</td>
              <td>{slugOf(markets, o.marketId)}</td>
              <td><span className={"badge " + o.side.toLowerCase()}>{o.side}</span></td>
              <td>{o.orderType}</td>
              <td>{o.price ? num(o.price) : "—"}</td>
              <td>{num(o.qty, 4)}</td>
              <td>{num(o.filledQty, 4)}</td>
              <td><span className={"badge s-" + o.status}>{o.status.replace("_", " ")}</span></td>
              <td><button className="linkbtn danger" onClick={() => cancel(o.id)}>Cancel</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------- order history */

export function OrderHistory({ orders, markets }: { orders: Order[]; markets: Market[] }) {
  if (!orders.length) return <Empty text="No orders yet" />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Time</th><th>Market</th><th>Side</th><th>Type</th>
            <th>Price</th><th>Qty</th><th>Filled</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="muted">{timeAgo(o.createdAt)}</td>
              <td>{slugOf(markets, o.marketId)}</td>
              <td><span className={"badge " + o.side.toLowerCase()}>{o.side}</span></td>
              <td>{o.orderType}</td>
              <td>{o.price ? num(o.price) : "—"}</td>
              <td>{num(o.qty, 4)}</td>
              <td>{num(o.filledQty, 4)}</td>
              <td><span className={"badge s-" + o.status}>{o.status.replace("_", " ")}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- live trades */

export function Trades({ trades, marketId }: { trades: Fill[]; marketId: string | null }) {
  const rows = marketId ? trades.filter((t) => t.marketId === marketId) : trades;
  if (!rows.length) return <Empty text="No trades yet" />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr><th>Time</th><th>Side</th><th>Price</th><th>Qty</th></tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.takerOrderId + i}>
              <td className="muted">{clockTime()}</td>
              <td className={t.takerSide === "BUY" ? "up" : "down"}>{t.takerSide}</td>
              <td className={t.takerSide === "BUY" ? "up" : "down"}>{num(t.price)}</td>
              <td>{num(t.qty, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
