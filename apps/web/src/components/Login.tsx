import { useEffect, useState } from "react";
import { signin, signup } from "../api";
import { useAuth, useToast } from "../state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Modal over the trading screen, so a guest who fills in an order and then
// signs up lands back on the same form with their values intact.
export function Login() {
  const { login, authMode, closeAuth } = useAuth();
  const { push } = useToast();
  const [mode, setMode] = useState<"in" | "up">(authMode ?? "up");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!username || !password) {
      setErr("Enter a username and password");
      return;
    }
    setBusy(true);
    try {
      // Signup returns a token itself, so a new user is logged in and can trade
      // immediately; signin is only for returning users.
      const res = mode === "up" ? await signup(username, password) : await signin(username, password);
      login(res.data);
      push("ok", mode === "up" ? "Account created — deposit in the Wallet to start trading" : "Signed in");
    } catch (e: any) {
      setErr(prettyError(e.message));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAuth(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAuth]);

  return (
    <div className="overlay p-4" onMouseDown={closeAuth}>
      <Card
        className="w-full max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "in" ? "Sign in" : "Create account"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CardHeader>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary bevel">◆</span>
            Perp
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground"
              aria-label="Close"
              onClick={closeAuth}
            >
              ✕
            </button>
          </div>
          <CardTitle className="mt-4">{mode === "in" ? "Sign in" : "Create account"}</CardTitle>
          <CardDescription>
            {mode === "in" ? "Welcome back. Trade perpetuals." : "Start trading in seconds."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Tabs value={mode} onValueChange={(v) => { setMode(v as "in" | "up"); setErr(""); }}>
            <TabsList>
              <TabsTrigger value="in">Sign in</TabsTrigger>
              <TabsTrigger value="up">Create</TabsTrigger>
            </TabsList>
          </Tabs>

          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="satoshi"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {err && <p className="text-sm font-medium text-destructive">{err}</p>}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function prettyError(code: string): string {
  switch (code) {
    case "USERNAME_ALREADY_EXSIST": return "That username is taken";
    case "INCORRECT_CREDENTIALS": return "No such user";
    case "INCORRECT_PASSWORD": return "Wrong password";
    case "INVALID_DATA": return "Check your input";
    case "BACKEND_UNREACHABLE": return "Backend is offline";
    default: return code;
  }
}
