// @vitest-environment node
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { b64url, ctEqual, fromB64url } from "../../supabase/functions/_shared/bytes";
import {
  hybridDecapsulate, hybridEncapsulate, hybridKeygen, isEnvelope, openEnvelopeText, PQC_SIZES,
  sealEnvelope, signKeygen, signMessage, verifySignature,
} from "../../supabase/functions/_shared/pqc";
import { issueLicense, verifyLicense } from "../../supabase/functions/_shared/license";
import { checkPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from "../../supabase/functions/_shared/passwords";
import { authenticate, byteaParam, checkSharedSecret, hashToken, newSessionToken, requireAdmin, requireSession } from "../../supabase/functions/_shared/auth";
import { fieldAad, openField, sealField, vaultConfigured } from "../../supabase/functions/_shared/vault";
import { RateLimiter } from "../../supabase/functions/_shared/http";

const enc = new TextEncoder();

describe("hybrid KEM (X25519 + ML-KEM-768)", () => {
  it("has the documented key sizes", () => {
    const k = hybridKeygen();
    expect(k.publicKey.length).toBe(PQC_SIZES.PK_LEN);
    expect(k.secretKey.length).toBe(PQC_SIZES.SK_LEN);
  });
  it("encapsulate/decapsulate agree; other keys do not", async () => {
    const a = hybridKeygen(), b = hybridKeygen();
    const { cipherText, sharedSecret } = await hybridEncapsulate(a.publicKey);
    expect(cipherText.length).toBe(PQC_SIZES.CT_LEN);
    expect(ctEqual(await hybridDecapsulate(cipherText, a.secretKey), sharedSecret)).toBe(true);
    expect(ctEqual(await hybridDecapsulate(cipherText, b.secretKey), sharedSecret)).toBe(false);
  });
  it("each encapsulation is fresh", async () => {
    const a = hybridKeygen();
    const x = await hybridEncapsulate(a.publicKey), y = await hybridEncapsulate(a.publicKey);
    expect(ctEqual(x.sharedSecret, y.sharedSecret)).toBe(false);
  });
  it("rejects malformed keys and ciphertexts", async () => {
    const a = hybridKeygen();
    await expect(hybridEncapsulate(a.publicKey.slice(1))).rejects.toThrow();
    await expect(hybridDecapsulate(new Uint8Array(10), a.secretKey)).rejects.toThrow();
  });
});

describe("envelopes", () => {
  const k = hybridKeygen();
  it("round-trips text including unicode", async () => {
    const msg = "We the People — 自由 — 🇺🇸";
    const env = await sealEnvelope(k.publicKey, msg, "ctx");
    expect(isEnvelope(env)).toBe(true);
    expect(env).not.toContain("People");
    expect(await openEnvelopeText(k.secretKey, env, "ctx")).toBe(msg);
  });
  it("is non-deterministic", async () => {
    expect(await sealEnvelope(k.publicKey, "same", "c")).not.toBe(await sealEnvelope(k.publicKey, "same", "c"));
  });
  it("fails on wrong context (AAD), wrong key, and tampering", async () => {
    const env = await sealEnvelope(k.publicKey, "secret", "user-a");
    await expect(openEnvelopeText(k.secretKey, env, "user-b")).rejects.toThrow(/decryption failed/);
    await expect(openEnvelopeText(hybridKeygen().secretKey, env, "user-a")).rejects.toThrow(/decryption failed/);
    const raw = fromB64url(env.slice(4)); raw[raw.length - 1] ^= 1;
    await expect(openEnvelopeText(k.secretKey, "sa1:" + b64url(raw), "user-a")).rejects.toThrow(/decryption failed/);
    const raw2 = fromB64url(env.slice(4)); raw2[40] ^= 1; // corrupt the X25519 ephemeral key
    await expect(openEnvelopeText(k.secretKey, "sa1:" + b64url(raw2), "user-a")).rejects.toThrow();
  });
  it("rejects non-envelopes and truncated data", async () => {
    await expect(openEnvelopeText(k.secretKey, "plain text", "c")).rejects.toThrow();
    await expect(openEnvelopeText(k.secretKey, "sa1:AAAA", "c")).rejects.toThrow();
  });
});

describe("ML-DSA-65 signatures", () => {
  const k = signKeygen();
  const m = enc.encode("message");
  it("verifies, and is bound to message and context", () => {
    const s = signMessage(k.secretKey, m, "ctx-a");
    expect(s.length).toBe(PQC_SIZES.DSA_SIG_LEN);
    expect(verifySignature(k.publicKey, m, s, "ctx-a")).toBe(true);
    expect(verifySignature(k.publicKey, m, s, "ctx-b")).toBe(false);
    expect(verifySignature(k.publicKey, enc.encode("other"), s, "ctx-a")).toBe(false);
    expect(verifySignature(signKeygen().publicKey, m, s, "ctx-a")).toBe(false);
    expect(verifySignature(k.publicKey, m, s.slice(1), "ctx-a")).toBe(false);
  });
});

describe("licenses", () => {
  const vendor = signKeygen();
  const base = { id: "SAS-2026-0001", holder: "Office of the Governor", max_accounts: 5, issued_at: "2026-10-21", expires_at: null };
  it("verifies a lifetime license", () => {
    const p = verifyLicense(issueLicense(vendor.secretKey, base), vendor.publicKey);
    expect(p.holder).toBe("Office of the Governor");
    expect(p.max_accounts).toBe(5);
  });
  it("rejects wrong vendor key, tampering, expiry, malformed, bad seat counts", () => {
    const tok = issueLicense(vendor.secretKey, base);
    expect(() => verifyLicense(tok, signKeygen().publicKey)).toThrow("invalid license");
    const [h, body, sig] = tok.split(".");
    const forged = JSON.stringify({ v: 1, ...base, max_accounts: 999 });
    expect(() => verifyLicense(`${h}.${b64url(enc.encode(forged))}.${sig}`, vendor.publicKey)).toThrow("invalid license");
    expect(() => verifyLicense(issueLicense(vendor.secretKey, { ...base, expires_at: "2020-01-01T00:00:00Z" }), vendor.publicKey)).toThrow("expired");
    expect(() => verifyLicense("garbage", vendor.publicKey)).toThrow("invalid license");
    expect(() => verifyLicense(issueLicense(vendor.secretKey, { ...base, max_accounts: 0 }), vendor.publicKey)).toThrow("invalid license");
    expect(() => verifyLicense(issueLicense(vendor.secretKey, { ...base, id: "bad id!" }), vendor.publicKey)).toThrow("invalid license");
    expect(() => verifyLicense(body, vendor.publicKey)).toThrow();
  });
  it("enforces deployment binding when present", () => {
    const tok = issueLicense(vendor.secretKey, { ...base, deployment: "dep-1" });
    expect(() => verifyLicense(tok, vendor.publicKey, { deployment: "dep-2" })).toThrow("different deployment");
    expect(verifyLicense(tok, vendor.publicKey, { deployment: "dep-1" }).id).toBe(base.id);
  });
});

describe("passwords (Argon2id)", () => {
  it("applies the policy", () => {
    expect(checkPasswordPolicy("short")).toMatch(/at least 12/);
    expect(checkPasswordPolicy("aaaaaaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(checkPasswordPolicy("x".repeat(300))).toMatch(/at most/);
    expect(checkPasswordPolicy("correct horse battery staple")).toBeNull();
    expect(checkPasswordPolicy(undefined)).toBeTruthy();
  });
  it("hashes with Argon2id, salts uniquely, verifies", async () => {
    const h1 = await hashPassword("correct horse battery staple");
    const h2 = await hashPassword("correct horse battery staple");
    expect(h1).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(h1).not.toBe(h2);
    expect(await verifyPassword("correct horse battery staple", h1)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl3", h1)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    await dummyVerify("whatever");
  }, 60_000);
  it("a pepper changes the result (database-only leak is not enough)", async () => {
    const h = await hashPassword("correct horse battery staple");
    process.env.PASSWORD_PEPPER = "pepper-pepper-pepper-pepper-1234";
    try { expect(await verifyPassword("correct horse battery staple", h)).toBe(false); }
    finally { delete process.env.PASSWORD_PEPPER; }
  }, 60_000);
});

describe("sessions", () => {
  it("issues 256-bit opaque tokens and stores only a hash", async () => {
    const { token, hash } = await newSessionToken();
    expect(token).toMatch(/^sas_[A-Za-z0-9_-]{43}$/);
    expect(ctEqual(hash, await hashToken(token))).toBe(true);
    expect(byteaParam(new Uint8Array([0, 255, 16]))).toBe("\\x00ff10");
  });
  const fakeDb = (row: unknown, seen: unknown[] = []) => ({
    rpc: async (fn: string, args?: Record<string, unknown>) => { seen.push({ fn, args }); return { data: row, error: null }; },
  });
  it("authenticates a good token and passes only the hash to the database", async () => {
    const { token } = await newSessionToken();
    const seen: any[] = [];
    const db = fakeDb({ session_id: "s1", user_id: "u1", email: "a@b.c", role: "admin" }, seen);
    const s = await authenticate(new Request("https://x", { headers: { "x-sa-session": token } }), db);
    expect(s).toEqual({ sessionId: "s1", userId: "u1", email: "a@b.c", role: "admin" });
    expect(seen[0].fn).toBe("sa_session_get");
    expect(JSON.stringify(seen)).not.toContain(token);
  });
  it("rejects missing, malformed, unknown and errored sessions with 401", async () => {
    const db = fakeDb(null);
    expect(await authenticate(new Request("https://x"), db)).toBeNull();
    expect(await authenticate(new Request("https://x", { headers: { "x-sa-session": "nope" } }), db)).toBeNull();
    const { token } = await newSessionToken();
    const r = await requireSession(new Request("https://x", { headers: { "x-sa-session": token } }), db);
    expect("response" in r && r.response.status).toBe(401);
    const bad = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    expect(await authenticate(new Request("https://x", { headers: { "x-sa-session": token } }), bad)).toBeNull();
  });
  it("requireAdmin returns 403 for ordinary users", async () => {
    const { token } = await newSessionToken();
    const db = fakeDb({ session_id: "s", user_id: "u", email: "e", role: "standard_user" });
    const r = await requireAdmin(new Request("https://x", { headers: { "x-sa-session": token } }), db);
    expect("response" in r && r.response.status).toBe(403);
  });
  it("shared secrets fail closed", async () => {
    const good = "a-very-long-shared-secret-value-123";
    expect(await checkSharedSecret(good, good)).toBe(true);
    expect(await checkSharedSecret("nope", good)).toBe(false);
    expect(await checkSharedSecret(null, good)).toBe(false);
    expect(await checkSharedSecret("x", undefined)).toBe(false);
    expect(await checkSharedSecret("short", "short")).toBe(false); // refuses weak configured secrets
  });
});

describe("vault (field encryption)", () => {
  const k = hybridKeygen();
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  beforeAll(() => {});
  it("seals and opens bound to table/column/user", async () => {
    process.env.VAULT_PUBLIC_KEY = b64url(k.publicKey);
    process.env.VAULT_SECRET_KEY = b64url(k.secretKey);
    expect(vaultConfigured()).toBe(true);
    const aad = fieldAad("belicia_memory", "content", "user-1");
    const sealed = await sealField("draft veto message", aad);
    expect(sealed).not.toContain("veto");
    expect(await openField(sealed, aad)).toBe("draft veto message");
    await expect(openField(sealed, fieldAad("belicia_memory", "content", "user-2"))).rejects.toThrow();
    expect(await openField("legacy plaintext row", aad)).toBe("legacy plaintext row");
  });
  it("fails closed when unconfigured (unless dev override)", async () => {
    delete process.env.VAULT_PUBLIC_KEY; delete process.env.VAULT_SECRET_KEY; delete process.env.SA_ALLOW_PLAINTEXT;
    await expect(sealField("x", "a")).rejects.toThrow(/Refusing to store/);
    process.env.SA_ALLOW_PLAINTEXT = "true";
    expect(await sealField("x", "a")).toBe("x");
  });
});

describe("rate limiter", () => {
  it("allows up to max per window then blocks, then recovers", () => {
    const rl = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => rl.allow("ip", 0))).toEqual([true, true, true, false]);
    expect(rl.allow("other", 0)).toBe(true);
    expect(rl.allow("ip", 1500)).toBe(true);
  });
});
