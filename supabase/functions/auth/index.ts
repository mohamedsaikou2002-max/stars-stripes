// Account authentication: license-gated registration, Argon2id login with lockout, opaque sessions.
// All writes go through the sa_* SECURITY DEFINER functions; the obfuscated tables are never addressed here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { byteaParam, authenticate, hashToken, newSessionToken, type Rpc } from "../_shared/auth.ts";
import { fromB64url } from "../_shared/bytes.ts";
import { clientIp, json, preflight, RateLimiter, SESSION_HEADER } from "../_shared/http.ts";
import { verifyLicense } from "../_shared/license.ts";
import { checkPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from "../_shared/passwords.ts";

const num = (k: string, d: number) => { const v = Number(Deno.env.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
const SESSION_TTL = num("SESSION_TTL_SECONDS", 12 * 3600);
const MAX_FAILED = num("MAX_FAILED_LOGINS", 5);
const LOCK_MINUTES = num("LOCKOUT_MINUTES", 15);
const MAX_BODY = 32 * 1024;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const registerLimiter = new RateLimiter(10, 10 * 60_000);
const loginLimiter = new RateLimiter(30, 10 * 60_000);

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc = db as unknown as Rpc;

async function audit(userId: string | null, action: string, detail: Record<string, unknown> = {}) {
  try { await db.rpc("sa_audit", { p_user: userId, p_action: action, p_detail: detail }); } catch { /* never block auth on logging */ }
}

async function issueSession(userId: string) {
  const { token, hash } = await newSessionToken();
  const { error } = await db.rpc("sa_session_create", { p_user: userId, p_token_hash: byteaParam(hash), p_ttl_seconds: SESSION_TTL });
  if (error) throw new Error("session_create_failed");
  return { token, expiresInSeconds: SESSION_TTL };
}

const normEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "Request too large." }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "Invalid JSON." }, 400); }
    const ip = clientIp(req);

    switch (body.action) {
      case "register": {
        if (!registerLimiter.allow(ip)) return json({ error: "Too many attempts. Try again later." }, 429);
        const email = normEmail(body.email);
        if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
        const policy = checkPasswordPolicy(body.password);
        if (policy) return json({ error: policy }, 400);

        const pub = Deno.env.get("VENDOR_LICENSE_PUBLIC_KEY");
        if (!pub) return json({ error: "Registration is not configured on this deployment." }, 503);
        let lic;
        try {
          lic = verifyLicense(String(body.license ?? ""), fromB64url(pub), { deployment: Deno.env.get("DEPLOYMENT_ID") });
        } catch {
          await audit(null, "register_rejected", { reason: "license" });
          return json({ error: "That license is invalid or has expired." }, 403);
        }

        const passwordHash = await hashPassword(String(body.password));
        const { data, error } = await db.rpc("sa_register", {
          p_email: email, p_password_hash: passwordHash, p_license_id: lic.id, p_holder: lic.holder,
          p_max_accounts: lic.max_accounts, p_expires: lic.expires_at,
        });
        if (error) {
          const msg = error.message ?? "";
          if (error.code === "SA001" || msg.includes("license_unavailable")) {
            await audit(null, "register_rejected", { reason: "seats", license: lic.id });
            return json({ error: "This license has no remaining seats or has been revoked." }, 403);
          }
          await audit(null, "register_rejected", { reason: "other", license: lic.id });
          return json({ error: "Registration could not be completed." }, 409); // deliberately generic (no email enumeration)
        }
        const { user_id, role } = data as { user_id: string; role: string };
        await audit(user_id, "register", { license: lic.id, role });
        const s = await issueSession(user_id);
        return json({ ...s, user: { id: user_id, email, role } }, 201);
      }

      case "login": {
        if (!loginLimiter.allow(ip)) return json({ error: "Too many attempts. Try again later." }, 429);
        const email = normEmail(body.email);
        const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
        const generic = () => json({ error: "Incorrect email or password." }, 401);
        if (!EMAIL_RE.test(email) || !password) { await dummyVerify(password || "x"); return generic(); }

        const { data: u } = await db.rpc("sa_user_get_by_email", { p_email: email });
        const user = u as null | { user_id: string; password_hash: string; role: string; is_active: boolean; locked_until: string | null };
        if (!user) { await dummyVerify(password); await audit(null, "login_failed", { reason: "unknown" }); return generic(); }
        if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
          await audit(user.user_id, "login_blocked", { reason: "locked" });
          return json({ error: "Too many failed attempts. Try again later." }, 429);
        }
        const ok = await verifyPassword(password, user.password_hash);
        if (!ok || !user.is_active) {
          if (!ok) await db.rpc("sa_login_failed", { p_user: user.user_id, p_max: MAX_FAILED, p_lock_minutes: LOCK_MINUTES });
          await audit(user.user_id, "login_failed", { reason: ok ? "inactive" : "password" });
          return generic();
        }
        await db.rpc("sa_login_ok", { p_user: user.user_id });
        await audit(user.user_id, "login");
        const s = await issueSession(user.user_id);
        return json({ ...s, user: { id: user.user_id, email, role: user.role } });
      }

      case "me": {
        const s = await authenticate(req, rpc);
        return s ? json({ user: { id: s.userId, email: s.email, role: s.role } }) : json({ error: "Authentication required." }, 401);
      }

      case "logout": {
        const s = await authenticate(req, rpc);
        const token = req.headers.get(SESSION_HEADER);
        if (s && token) { await db.rpc("sa_session_revoke", { p_token_hash: byteaParam(await hashToken(token)) }); await audit(s.userId, "logout"); }
        return json({ ok: true });
      }

      case "logout_all": {
        const s = await authenticate(req, rpc);
        if (!s) return json({ error: "Authentication required." }, 401);
        await db.rpc("sa_session_revoke_all", { p_user: s.userId });
        await audit(s.userId, "logout_all");
        return json({ ok: true });
      }

      case "change_password": {
        if (!loginLimiter.allow(ip)) return json({ error: "Too many attempts. Try again later." }, 429);
        const s = await authenticate(req, rpc);
        if (!s) return json({ error: "Authentication required." }, 401);
        const policy = checkPasswordPolicy(body.next);
        if (policy) return json({ error: policy }, 400);
        const { data: u } = await db.rpc("sa_user_get_by_email", { p_email: s.email });
        const user = u as null | { password_hash: string };
        if (!user || !(await verifyPassword(String(body.current ?? ""), user.password_hash))) {
          await audit(s.userId, "change_password_failed");
          return json({ error: "Current password is incorrect." }, 403);
        }
        await db.rpc("sa_set_password", { p_user: s.userId, p_password_hash: await hashPassword(String(body.next)) }); // revokes every session
        await audit(s.userId, "change_password");
        const fresh = await issueSession(s.userId);
        return json({ ok: true, ...fresh });
      }

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    console.error("auth error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
