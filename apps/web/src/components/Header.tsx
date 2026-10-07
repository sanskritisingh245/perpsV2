import { useAuth, useFills } from "../state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tab = "trade" | "wallet";

export function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { logout, signedIn, openAuth } = useAuth();
  const { connected } = useFills();

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
        {!signedIn ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => openAuth("in")}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => openAuth("up")}>
              Sign up
            </Button>
          </>
        ) : (
        <>
        <Button size="sm" onClick={() => onTab("wallet")}>
          Deposit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="avatar" aria-label="Account menu">◆</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <span className="block font-semibold text-foreground">Trader</span>
              <span className="block text-xs text-muted-foreground">Signed in</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onTab("trade")}>Trade</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTab("wallet")}>Wallet</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </>
        )}
      </div>
    </header>
  );
}
