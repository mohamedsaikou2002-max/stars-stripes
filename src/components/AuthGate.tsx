import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from 'react-router-dom';
import { backendConfigured } from "@/integrations/supabase/client";
import { login, register, restoreSession, useSessionUser } from "@/lib/session";

const field = "w-full rounded-lg border border-slate-900/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-800";

export default function AuthGate({ children }: { children: ReactNode }) {
  const user = useSessionUser();
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [license, setLicense] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { restoreSession().finally(() => setReady(true)); }, []);

  if (!backendConfigured || user) return <>{children}</>;
  if (!ready) return <main className="p-6 text-slate-900/60">Loading…</main>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, license.trim());
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 border border-slate-900/15 rounded-2xl p-6 bg-slate-100" autoComplete="on">
        <header>
          <h1 className="text-2xl font-light tracking-[0.3em]">STARS AND STRIPES</h1>
          <p className="text-xs tracking-widest text-slate-900/60 mt-1">{mode === "login" ? "SIGN IN" : "ACTIVATE YOUR ACCOUNT"}</p>
          <Link to="/eagle-view" className="block text-sm text-blue-800 underline mt-3">Open EAGLE VIEW · no database required</Link>
        </header>
        <label className="block text-xs tracking-widest text-slate-900/70">EMAIL
          <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="block text-xs tracking-widest text-slate-900/70">PASSWORD
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 12 : undefined} required />
          {mode === "register" && <span className="block mt-1 normal-case tracking-normal text-slate-900/60">At least 12 characters; a passphrase works well.</span>}
        </label>
        {mode === "register" && (
          <label className="block text-xs tracking-widest text-slate-900/70">LICENSE KEY
            <textarea className={field + " font-mono text-xs h-24"} value={license} onChange={(e) => setLicense(e.target.value)} spellCheck={false} required />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-blue-900 text-white py-2 text-sm tracking-widest disabled:opacity-60">
          {busy ? "PLEASE WAIT…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
        </button>
        <button type="button" className="w-full text-xs tracking-widest text-slate-900/60 hover:text-slate-900"
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "HAVE A LICENSE KEY? ACTIVATE" : "ALREADY ACTIVATED? SIGN IN"}
        </button>
      </form>
    </main>
  );
}
