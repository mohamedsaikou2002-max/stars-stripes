// Conversation history, profile and briefs for the AUTHENTICATED account only.
// The acting user always comes from the session; any user_id in the request is ignored.
import { gate, serviceClient } from "../_shared/gate.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { fieldAad, openField } from "../_shared/vault.ts";

// Columns an account may write on its own profile (no mass assignment of user_id, telemetry, etc.).
const PROFILE_WRITABLE = new Set([
  "name", "display_name", "preferences", "thought_patterns", "projects", "preferred_inquiry_mode", "voice_profile",
  "response_depth", "language_register", "active_missions", "key_relationships", "strategic_context",
  "office_role", "jurisdiction", "office_location", "timezone", "push_subscription", "pemf_enabled", "baseline_hrv",
  "peak_focus_windows", "pemf_sleep_protocol", "pemf_morning_protocol", "preferred_suggestion_density",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function openRow<T extends { content: string }>(row: T, userId: string): Promise<T> {
  try { return { ...row, content: await openField(row.content, fieldAad("belicia_memory", "content", userId)) }; }
  catch { return { ...row, content: "[unable to decrypt this entry]" }; }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const s = await gate(req);
  if (s instanceof Response) return s;
  const userId = s.userId;
  const supabase = serviceClient();

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "recent";

    if (req.method === "GET") {
      if (action === "recent") {
        const sid = url.searchParams.get("session_id");
        if (sid && !UUID_RE.test(sid)) return json({ error: "invalid session_id" }, 400);
        let q = supabase.from("belicia_memory").select("role, content, created_at, session_id").eq("user_id", userId);
        if (sid) q = q.eq("session_id", sid);
        const { data } = await q.order("created_at", { ascending: false }).limit(100);
        const rows = await Promise.all((data ?? []).map((r: { content: string; role: string }) => openRow(r, userId)));
        return json({ messages: rows.reverse() });
      }
      if (action === "sessions") {
        const { data } = await supabase.from("belicia_memory").select("session_id, content, role, created_at")
          .eq("user_id", userId).not("session_id", "is", null).order("created_at", { ascending: false }).limit(300);
        const map = new Map<string, { session_id: string; preview: string; last: string; first: string }>();
        for (const row of (data ?? []) as { session_id: string; content: string; role: string; created_at: string }[]) {
          const existing = map.get(row.session_id);
          if (!existing) {
            map.set(row.session_id, { session_id: row.session_id, preview: "", last: row.created_at, first: row.created_at });
          } else existing.first = row.created_at;
        }
        // Decrypt only the one user message per session that becomes its preview.
        const seen = new Set<string>();
        for (const row of [...(data ?? [])].reverse() as { session_id: string; content: string; role: string }[]) {
          if (row.role !== "user" || seen.has(row.session_id)) continue;
          seen.add(row.session_id);
          const opened = await openRow(row, userId);
          const e = map.get(row.session_id); if (e) e.preview = opened.content.slice(0, 80);
        }
        return json({ sessions: Array.from(map.values()).sort((a, b) => b.last.localeCompare(a.last)) });
      }
      if (action === "profile") {
        const { data } = await supabase.from("belicia_profile").select("*").eq("user_id", userId).limit(1);
        return json({ profile: data?.[0] ?? null });
      }
      if (action === "briefs") {
        const { data } = await supabase.from("scheduled_briefs").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(100);
        const briefs = await Promise.all((data ?? []).map(async (b: { content: string | null }) => {
          if (!b.content) return b;
          try { return { ...b, content: await openField(b.content, fieldAad("scheduled_briefs", "content", userId)) }; }
          catch { return { ...b, content: "[unable to decrypt this entry]" }; }
        }));
        return json({ briefs });
      }
    }

    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { /* empty body */ }
      if (action === "clear") {
        await supabase.from("belicia_memory").delete().eq("user_id", userId);
        return json({ ok: true });
      }
      if (action === "profile") {
        const updates: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(body)) if (PROFILE_WRITABLE.has(k)) updates[k] = v;
        const { data, error } = await supabase.from("belicia_profile").upsert(updates, { onConflict: "user_id" }).select();
        if (error) return json({ error: "Could not save profile." }, 400);
        return json({ profile: data?.[0] });
      }
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("memory error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong." }, 500);
  }
});
void corsHeaders;
