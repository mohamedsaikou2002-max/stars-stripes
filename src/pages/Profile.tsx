import { invokeFn } from "@/lib/session";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TopNav } from "@/components/TopNav";
import { toast } from "sonner";
import { usePushNotifications } from "@/hooks/usePushNotifications";

type Profile = any;

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="block text-[10px] tracking-widest text-slate-900/60 mb-1.5">{label}</span>
    {children}
  </label>
);

const ProfilePage = () => {
  const [p, setP] = useState<Profile | null>(null);
  const [missionsText, setMissionsText] = useState("");
  const [saving, setSaving] = useState(false);
  const push = usePushNotifications();

  useEffect(() => {
    (async () => {
      const { data: res } = await invokeFn<{ profile: any }>("memory", { query: { action: "profile" } });
      const data = res?.profile ?? null;
      setP(data ?? {});
      setMissionsText((((data?.active_missions ?? []) as unknown) as string[]).join("\n"));
    })();
  }, []);

  const update = (k: string, v: any) => setP((prev: any) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!p) return;
    setSaving(true);
    const missions = missionsText.split("\n").map(s => s.trim()).filter(Boolean);
    const payload: any = {
      display_name: p.display_name ?? null,
      preferred_inquiry_mode: p.preferred_inquiry_mode ?? "leadership",
      response_depth: p.response_depth ?? "balanced",
      language_register: p.language_register ?? "scholarly",
      active_missions: missions,
      strategic_context: p.strategic_context ?? null,
      office_role: p.office_role ?? null,
      jurisdiction: p.jurisdiction ?? null,
      pemf_enabled: !!p.pemf_enabled,
      baseline_hrv: p.baseline_hrv ? Number(p.baseline_hrv) : null,
      pemf_sleep_protocol: p.pemf_sleep_protocol ?? "delta_standard",
      pemf_morning_protocol: p.pemf_morning_protocol ?? "energize_10hz",
      timezone: p.timezone ?? "UTC",
      office_location: p.office_location ?? null,
    };
    const { error } = await invokeFn("memory", { query: { action: "profile" }, body: payload });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Profile saved");
  };

  if (!p) return <main className="p-6 text-slate-900/60">Loading…</main>;

  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <header className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-[0.3em] text-glow">PROFILE</h1>
          <p className="text-xs text-slate-900/60 tracking-widest mt-1">STRATEGIC CONFIGURATION</p>
        </div>
        <TopNav />
      </header>

      <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
        <section className="space-y-4 border border-slate-900/15 rounded-2xl p-5 bg-slate-100">
          <h2 className="text-sm tracking-widest text-slate-900/70">IDENTITY</h2>
          <Field label="Display name">
            <Input value={p.display_name ?? ""} onChange={(e) => update("display_name", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
          <Field label="Office / public-service role">
            <Input value={p.office_role ?? ""} onChange={(e) => update("office_role", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
          <Field label="Jurisdiction">
            <Input value={p.jurisdiction ?? ""} onChange={(e) => update("jurisdiction", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
          <Field label="Timezone (e.g. America/New_York)">
            <Input value={p.timezone ?? ""} onChange={(e) => update("timezone", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
        </section>

        <section className="space-y-4 border border-slate-900/15 rounded-2xl p-5 bg-slate-100">
          <h2 className="text-sm tracking-widest text-slate-900/70">MISSION</h2>
          <Field label="Active missions (one per line)">
            <textarea
              value={missionsText}
              onChange={(e) => setMissionsText(e.target.value)}
              rows={5}
              className="w-full bg-transparent border border-slate-900/20 rounded-md p-2 text-sm text-slate-900"
            />
          </Field>
          <Field label="Strategic context">
            <textarea
              value={p.strategic_context ?? ""}
              onChange={(e) => update("strategic_context", e.target.value)}
              rows={4}
              className="w-full bg-transparent border border-slate-900/20 rounded-md p-2 text-sm text-slate-900"
            />
          </Field>
        </section>

        <section className="space-y-4 border border-slate-900/15 rounded-2xl p-5 bg-slate-100">
          <h2 className="text-sm tracking-widest text-slate-900/70">OPTIONAL WELLNESS INTEGRATION</h2>
          <label className="flex items-center justify-between gap-2 text-sm text-slate-900/80">
            <span>PEMF enabled</span>
            <Switch checked={!!p.pemf_enabled} onCheckedChange={(v) => update("pemf_enabled", v)} />
          </label>
          <Field label="Baseline HRV">
            <Input type="number" value={p.baseline_hrv ?? ""} onChange={(e) => update("baseline_hrv", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
          <Field label="Sleep protocol">
            <Input value={p.pemf_sleep_protocol ?? ""} onChange={(e) => update("pemf_sleep_protocol", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
          <Field label="Morning protocol">
            <Input value={p.pemf_morning_protocol ?? ""} onChange={(e) => update("pemf_morning_protocol", e.target.value)} className="bg-transparent border-slate-900/20 text-slate-900" />
          </Field>
        </section>

        <section className="space-y-4 border border-slate-900/15 rounded-2xl p-5 bg-slate-100">
          <h2 className="text-sm tracking-widest text-slate-900/70">OFFICE LOCATION</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <Input type="number" value={p.office_location?.lat ?? ""} onChange={(e) => update("office_location", { ...(p.office_location ?? {}), lat: Number(e.target.value) })} className="bg-transparent border-slate-900/20 text-slate-900" />
            </Field>
            <Field label="Longitude">
              <Input type="number" value={p.office_location?.lng ?? ""} onChange={(e) => update("office_location", { ...(p.office_location ?? {}), lng: Number(e.target.value) })} className="bg-transparent border-slate-900/20 text-slate-900" />
            </Field>
          </div>
          <div className="pt-2">
            <h3 className="text-[10px] tracking-widest text-slate-900/60 mb-2">MORNING BRIEFS</h3>
            {!push.isSupported && <p className="text-xs text-slate-900/60">Push not supported in this preview. Works in the published build.</p>}
            {push.isSupported && (
              <Button
                onClick={push.isSubscribed ? push.unsubscribe : push.subscribe}
                className="bg-slate-100 hover:bg-slate-100 border border-slate-900/30 text-slate-900"
              >
                {push.isSubscribed ? "Disable morning briefs" : "Enable morning briefs"}
              </Button>
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 max-w-4xl flex justify-end">
        <Button disabled={saving} onClick={save} className="bg-slate-100 hover:bg-slate-100 border border-slate-900/30 text-slate-900 px-6">
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </main>
  );
};

export default ProfilePage;
