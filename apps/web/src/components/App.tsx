import { useState } from "react";
import { useAuth, useToast } from "../state";
import { Login } from "./Login";
import { Header } from "./Header";
import { Trade } from "./Trade";
import { Wallet } from "./Wallet";

export function App() {
  const { signedIn } = useAuth();
  const [tab, setTab] = useState<"trade" | "wallet">("trade");

  return (
    <>
      {signedIn ? (
        <>
          <Header tab={tab} onTab={setTab} />
          {tab === "trade" ? <Trade /> : <div className="page"><Wallet /></div>}
        </>
      ) : (
        <Login />
      )}
      <Toaster />
    </>
  );
}

function Toaster() {
  const { toasts } = useToast();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.kind}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
