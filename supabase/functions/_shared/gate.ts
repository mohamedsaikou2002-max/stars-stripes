// One-line authentication gate for Edge Functions, plus feature flags for optional modules.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireSession, type Rpc, type Session } from "./auth.ts";
import { json } from "./http.ts";

let client: ReturnType<typeof createClient> | undefined;
export function serviceClient() {
  client ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** const s = await gate(req); if (s instanceof Response) return s;  -> s.userId is trustworthy */
export async function gate(req: Request): Promise<Session | Response> {
  const a = await requireSession(req, serviceClient() as unknown as Rpc);
  return "response" in a ? a.response : a.session;
}

/** Optional modules (home/PEMF hardware bridge, Eagle Eye) ship OFF and must be enabled per deployment. */
export function featureEnabled(flag: string): boolean {
  return Deno.env.get(flag) === "true";
}
export const featureDisabled = (name: string) =>
  json({ error: `${name} is disabled on this deployment.` }, 403);
