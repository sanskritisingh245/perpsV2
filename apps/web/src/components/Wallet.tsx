import { useCallback, useEffect, useState } from "react";
import { getBalance, onRamp, deleteMarket, isAdminView } from "../api";
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
  const [adminSecret, setAdminSecret] = useState("");

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
      push("err", friendlyError(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeMarket(id: string, slug: string) {
    if (!confirm(`Delete market ${slug} for everyone?`)) return;
    try {
      await deleteMarket(id, adminSecret);
      remove(id);
      push("ok", `Market ${slug} deleted`);
    } catch (e: any) {
      push("err", friendlyError(e.message));
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

      {isAdminView && (
        <div className="panelcard">
          <div className="row" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Markets (admin)</h2>
            <div className="spacer" />
            <button className="btn sm" onClick={() => setShowAdd(true)}>+ Create market</button>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Admin secret (needed to delete)</label>
            <div className="input">
              <input type="password" placeholder="ADMIN_SECRET" value={adminSecret} onChange={(e) => setAdminSecret(e.target.value)} />
            </div>
          </div>
          {markets.length ? (
            <table>
              <thead><tr><th>Slug</th><th>Market id</th><th></th></tr></thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.id}>
                    <td>{m.slug}</td>
                    <td className="muted">{shortId(m.id, 16)}…</td>
                    <td>
                      <button className="linkbtn danger" disabled={!adminSecret} onClick={() => removeMarket(m.id, m.slug)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="note">No markets yet.</p>
          )}
        </div>
      )}

      {showAdd && <AddMarket onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// Turn raw backend/Prisma error codes into something a user can act on.
function friendlyError(code: string): string {
  switch (code) {
    // Prisma P2003 = foreign-key constraint: the on-ramp tried to create a
    // Balance for a userId that has no matching User row — i.e. the logged-in
    // token no longer maps to a user in the backend DB (reset DB, or a token
    // minted against another environment). Re-authenticating fixes it.
    case "P2003": return "Your session is out of date — log out and sign in again";
    case "P2002": return "That already exists";
    case "P2025": return "Account not found — log out and sign in again";
    case "INVALID_DATA": return "Enter a valid amount";
    case "FORBIDDEN": return "Wrong admin secret";
    case "MARKET_IN_USE": return "Market has open orders or positions — close them first";
    case "MARKET_NOT_FOUND": return "Market already deleted";
    case "NOT_ENOUGH_BALANCE": return "Not enough balance";
    case "INCORRECT_TOKEN":
    case "UNAUTHORIZED":
    case "token not found ehhh": return "Please sign in again";
    case "BACKEND_UNREACHABLE": return "Backend is offline — try again shortly";
    default:
      // Hide any other raw Prisma code (P####); pass through readable messages.
      return /^P\d{4}$/.test(code) ? "Something went wrong — please try again" : code;
  }
}
