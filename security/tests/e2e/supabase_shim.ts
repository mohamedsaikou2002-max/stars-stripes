// Test-only stand-in for supabase-js: runs .rpc() calls straight against a local Postgres so the real
// Edge Function code can be exercised end-to-end without a Supabase stack. Only rpc() is implemented.
import postgres from "postgres";

const sql = postgres(Deno.env.get("PGURL")!, { max: 4, onnotice: () => {} });

export function createClient() {
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      if (!/^sa_[a-z_]+$/.test(fn)) return { data: null, error: { message: "bad rpc name" } };
      const keys = Object.keys(args);
      const params = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : (v as string | number | null);
      });
      const call = `SELECT public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) AS r`;
      try {
        const rows = await sql.unsafe(call, params as never[]);
        return { data: rows[0]?.r ?? null, error: null };
      } catch (e) {
        const err = e as { message: string; code?: string };
        return { data: null, error: { message: err.message, code: err.code } };
      }
    },
  };
}
