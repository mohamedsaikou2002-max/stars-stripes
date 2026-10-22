// Shared HTTP helpers: CORS, JSON responses, tiny in-memory rate limiter.
export const SESSION_HEADER = "x-sa-session";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // bearer-token auth (no cookies), so wildcard origin is not a CSRF vector
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, ${SESSION_HEADER}, x-cron-secret`,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

const secureHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, ...secureHeaders, ...extra } });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: corsHeaders }) : null;
}

export const unauthorized = (): Response => json({ error: "Authentication required." }, 401, { "WWW-Authenticate": "Bearer" });

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Best-effort per-isolate limiter. Real brute-force defence is the per-account lockout in the database. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const k of this.hits.keys()) { this.hits.delete(k); break; }
    return true;
  }
}
