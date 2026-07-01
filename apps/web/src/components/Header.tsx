import { useEffect, useRef, useState } from "react";
import { useAuth, useFills } from "../state";

type Tab = "trade" | "wallet";

export function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { logout } = useAuth();
  const { connected } = useFills();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  // play the exit animation, then unmount
  const close = () => {
    if (!openRef.current) return;
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 170);
  };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <header className="header">
      <div className="logo">
        <span className="mark">◆</span> Perp
      </div>
      <nav className="nav">
        <a className={tab === "trade" ? "active" : ""} onClick={() => onTab("trade")}>
          Trade
        </a>
        <a className={tab === "wallet" ? "active" : ""} onClick={() => onTab("wallet")}>
          Wallet
        </a>
      </nav>

      <div className="right">
        <span className="pill" title={connected ? "Live feed connected" : "Feed offline"}>
          <span className={"dot" + (connected ? " on" : "")} />
          {connected ? "Live" : "Offline"}
        </span>
        <button className="btn gold sm" onClick={() => onTab("wallet")}>
          Deposit
        </button>
        <div className="menu-wrap" ref={wrap}>
          <button className="avatar" onClick={() => (open ? close() : setOpen(true))}>
            ◆
          </button>
          {open && (
            <div className={"menu" + (closing ? " closing" : "")}>
              <div className="who">
                <b>Trader</b>
                <span className="muted">Signed in</span>
              </div>
              <a onClick={() => { onTab("trade"); close(); }}>Trade</a>
              <a onClick={() => { onTab("wallet"); close(); }}>Wallet</a>
              <button onClick={logout}>Log out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
