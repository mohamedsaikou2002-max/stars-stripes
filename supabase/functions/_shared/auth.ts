// Session authentication. Sessions are opaque 256-bit random bearer tokens; only SHA-256(token) is stored.
// Every Edge Function derives the acting user from the session, never from the request body.
import { b64url, randomBytes, sha256, toHex, utf8 } from "./bytes.ts";
import { json, SESSION_HEADER, unauthorized } from "./http.ts";

export type Role = "admin" | "standard_user";
export type Session = { sessionId: string; userId: string; email: string; role: Role };
export type Rpc = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const TOKEN_RE = /^sas_[A-Za-z0-9_-]{43}$/;

export async function hashToken(token: string): Promise<Uint8Array> {
  return sha256(utf8.encode(token));
}

/** PostgREST bytea parameters travel as "\x<hex>". */
export const byteaParam = (b: Uint8Array): string => "\\x" + toHex(b);

export async function newSessionToken(): Promise<{ token: string; hash: Uint8Array }> {
  const token = "sas_" + b64url(randomBytes(32));
  return { token, hash: await hashToken(token) };
}

export async function authenticate(req: Request, db: Rpc): Promise<Session | null> {
  const token = req.headers.get(SESSION_HEADER);
  if (!token || !TOKEN_RE.test(token)) return null;
  const { data, error } = await db.rpc("sa_session_get", { p_token_hash: byteaParam(await hashToken(token)) });
  if (error || !data) return null;
  const d = data as { session_id: string; user_id: string; email: string; role: Role };
  return { sessionId: d.session_id, userId: d.user_id, email: d.email, role: d.role };
}

/** Usage: const a = await requireSession(req, db); if ("response" in a) return a.response; const { session } = a; */
export async function requireSession(req: Request, db: Rpc): Promise<{ session: Session } | { response: Response }> {
  const session = await authenticate(req, db);
  return session ? { session } : { response: unauthorized() };
}

export async function requireAdmin(req: Request, db: Rpc): Promise<{ session: Session } | { response: Response }> {
  const a = await requireSession(req, db);
  if ("response" in a) return a;
  return a.session.role === "admin" ? a : { response: json({ error: "Administrator access required." }, 403) };
}

/** Machine-to-machine endpoints (cron, devices): shared secret, constant-time compared, fail closed if unset. */
export async function checkSharedSecret(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 24 || !provided) return false;
  const [a, b] = await Promise.all([sha256(utf8.encode(provided)), sha256(utf8.encode(expected))]);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
