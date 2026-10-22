import { invokeFn } from "@/lib/session";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TopNav } from "@/components/TopNav";
import { toast } from "sonner";

const SCENES = [
  { action: "focus_mode", label: "Focus" },
  { action: "reflection_mode", label: "Reflection" },
  { action: "sleep_mode", label: "Sleep" },
  { action: "morning_energize", label: "Morning" },
  { action: "recovery_mode", label: "Recovery" },
];

type Cmd = { id: string; command: any; executed_at: string; status: string | null };

const HomePage = () => {
  const [log, setLog] = useState<Cmd[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const { data } = await invokeFn<{ commands: Cmd[] }>("home-bridge", { body: { action: "list" } });
    setLog(data?.commands ?? []);
  };

  useEffect(() => { refresh(); }, []);

  const fire = async (action: string) => {
    setBusy(action);
    try {
      const { data, error } = await invokeFn("home-bridge", {
        body: { command: { type: "scene", action, params: {} } },
      });
      if (error) throw error;
      toast.success(`${action} fired (${(data as any)?.executed?.length || 0} targets)`);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(null); }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <header className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-[0.3em] text-glow">HOME</h1>
          <p className="text-xs text-slate-900/60 tracking-widest mt-1">ENVIRONMENT CONTROL</p>
        </div>
        <TopNav />
      </header>

      <section className="mb-10">
        <h2 className="text-sm tracking-widest text-slate-900/70 mb-4">SCENES</h2>
        <div className="flex flex-wrap gap-3">
          {SCENES.map((s) => (
            <Button
              key={s.action}
              disabled={busy === s.action}
              onClick={() => fire(s.action)}
              className="bg-slate-100 hover:bg-slate-100 border border-slate-900/30 text-slate-900 px-6 py-6 font-[Tektur] tracking-widest"
            >
              {s.label.toUpperCase()}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-slate-900/60 mt-3">
          Requires HOME_ASSISTANT_WEBHOOK_URL and PEMF_CONTROLLER_URL secrets to actually fire downstream.
        </p>
      </section>

      <section>
        <h2 className="text-sm tracking-widest text-slate-900/70 mb-4">COMMAND LOG</h2>
        {log.length === 0 && <p className="text-slate-900/60 text-sm">No commands yet.</p>}
        <div className="space-y-2 max-w-3xl">
          {log.map((c) => (
            <div key={c.id} className="border border-slate-900/10 rounded-lg p-3 bg-slate-100 flex items-center justify-between text-xs">
              <span className="font-[Tektur] tracking-widest text-slate-900/80">
                {c.command?.action ?? "—"} <span className="text-slate-900/60">· {c.status}</span>
              </span>
              <span className="text-slate-900/60">{new Date(c.executed_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};

export default HomePage;
