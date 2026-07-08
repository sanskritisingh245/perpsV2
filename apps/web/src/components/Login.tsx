import { useState } from "react";
import { signin, signup } from "../api";
import { useAuth, useToast } from "../state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Login() {
  const { login } = useAuth();
  const { push } = useToast();
  const [mode, setMode] = useState<"in" | "up">("in");
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
      if (mode === "up") {
        await signup(username, password);
        push("ok", "Account created");
      }
      const res = await signin(username, password);
      login(res.data);
      push("ok", "Signed in");
    } catch (e: any) {
      setErr(prettyError(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary bevel">◆</span>
            Perp
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
