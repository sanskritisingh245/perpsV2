import { useCallback, useEffect, useState } from "react";
import { getBalance, onRamp } from "../api";
import type { Balance } from "../types";
import { useMarkets, useToast } from "../state";
import { num, shortId } from "../format";
import { AddMarket } from "./AddMarket";

export function Wallet() {
  const { push } = useToast();
  const { markets, remove } = useMarkets();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await getBalance();
      setBalance(b.data);
    } catch {
      setBalance(null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const available = Number(balance?.available ?? 0);
  const locked = Number(balance?.locked ?? 0);

  async function deposit() {
    if (!Number(amount)) return;
    setBusy(true);
    try {
      await onRamp(amount, "USD");
      push("ok", `Deposited ${num(amount)} USD`);
      setAmount("");
      load();
    } catch (e: any) {
      push("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wallet">
      <div className="panelcard">
        <h2>Collateral balance (USD)</h2>
        <div className="balgrid">
          <div className="b"><div className="k">Available</div><div className="v">{num(available)}</div></div>
          <div className="b"><div className="k">Locked (margin)</div><div className="v">{num(locked)}</div></div>
          <div className="b"><div className="k">Equity</div><div className="v">{num(available + locked)}</div></div>
        </div>
      </div>

      <div className="panelcard">
        <h2>Deposit (test faucet)</h2>
        <div className="inline-form">
          <div className="field">
            <label>Amount (USD)</label>
            <div className="input">
              <input
                className="mono"
                inputMode="decimal"
                placeholder="1000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="suffix">USD</span>
            </div>
          </div>
          <button className="btn gold" onClick={deposit} disabled={busy || !Number(amount)}>
            {busy ? "Depositing…" : "Deposit"}
          </button>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Calls <code>/api/on-ramp</code> to credit your USD collateral. There are no real funds.
        </p>
      </div>

      <div className="panelcard">
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Markets</h2>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setShowAdd(true)}>+ Add market</button>
        </div>
        {markets.length ? (
          <table>
            <thead><tr><th>Slug</th><th>Market id</th><th></th></tr></thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.id}>
                  <td>{m.slug}</td>
                  <td className="muted">{shortId(m.id, 16)}…</td>
                  <td><button className="linkbtn danger" onClick={() => remove(m.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="note">
            No markets tracked. Create one with the admin secret, or add an existing market id.
            The backend exposes no market-list endpoint, so this set lives in your browser.
          </p>
        )}
      </div>

      {showAdd && <AddMarket onClose={() => setShowAdd(false)} />}
    </div>
  );
}
