import { useState } from "react";
import { signin, signup } from "../api";
import { useAuth, useToast } from "../state";

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
    <div className="center">
      <form className="card" onSubmit={submit}>
        <div className="logo" style={{ marginBottom: 18 }}>
          <span className="mark">◆</span> Perp
        </div>
        <h1>{mode === "in" ? "Sign in" : "Create account"}</h1>
        <p className="sub">
          {mode === "in" ? "Welcome back. Trade perpetuals." : "Start trading in seconds."}
        </p>

        <div className="field">
          <label>Username</label>
          <div className="input">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="satoshi"
              autoFocus
            />
          </div>
        </div>
        <div className="field">
          <label>Password</label>
          <div className="input">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>

        <div className="err">{err}</div>

        <button className="btn gold" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
        </button>

        <div className="switchline">
          {mode === "in" ? "New here?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(""); }}>
            {mode === "in" ? "Create one" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

function prettyError(code: string): string {
  switch (code) {
    case "USERNAME_ALREADY_EXSIST": return "That username is taken";
    case "INCORRECT_CREDENTIALS": return "No such user";
    case "INCORRECT_PASSWORD": return "Wrong password";
    case "INVALID_DATA": return "Check your input";
    case "BACKEND_UNREACHABLE": return "Backend is offline (start it on :3000)";
    default: return code;
  }
}
