import { useState } from "react";
import { useAuth } from "../state";
import { Login } from "./Login";
import { Header } from "./Header";
import { Trade } from "./Trade";
import { Wallet } from "./Wallet";
import { Toaster } from "@/components/ui/sonner";

// Guests see the full trading screen (charts, book, trades are all public);
// anything account-specific asks them to sign in via the Login modal.
export function App() {
  const { signedIn, authMode, openAuth } = useAuth();
  const [tab, setTab] = useState<"trade" | "wallet">("trade");

  return (
    <>
      <Header tab={tab} onTab={setTab} />
      {tab === "trade" ? (
        <Trade />
      ) : (
        <div className="page">
          {signedIn ? (
            <Wallet />
          ) : (
            <div className="wallet">
              <div className="panelcard">
                <h2>Wallet</h2>
                <p className="note" style={{ marginBottom: 14 }}>
                  Create a free account to deposit test collateral and start trading.
                </p>
                <button className="btn gold" onClick={() => openAuth("up")}>Sign up</button>
              </div>
            </div>
          )}
        </div>
      )}
      {authMode && <Login />}
      <Toaster />
    </>
  );
}
