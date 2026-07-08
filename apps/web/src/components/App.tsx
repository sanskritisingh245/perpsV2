import { useState } from "react";
import { useAuth } from "../state";
import { Login } from "./Login";
import { Header } from "./Header";
import { Trade } from "./Trade";
import { Wallet } from "./Wallet";
import { Toaster } from "@/components/ui/sonner";

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
