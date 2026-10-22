// Vendor-signed license tokens (ML-DSA-65). Only the vendor holds the signing key; deployments embed
// the public key and verify offline. Token = "sa-lic1." + b64url(payload JSON) + "." + b64url(signature).
import { b64url, fromB64url, toText, utf8 } from "./bytes.ts";
import { signMessage, verifySignature } from "./pqc.ts";

export const LICENSE_CONTEXT = "stars-and-stripes/license/v1";
const PREFIX = "sa-lic1.";

export type LicensePayload = {
  v: 1;
  id: string;                 // unique license id, e.g. "SAS-2026-0001"
  holder: string;             // customer name
  max_accounts: number;       // seats
  issued_at: string;          // ISO date
  expires_at: string | null;  // null = lifetime
  deployment?: string;        // optional: bind to one deployment id
};

export function issueLicense(vendorSecretKey: Uint8Array, payload: Omit<LicensePayload, "v">): string {
  const body = utf8.encode(JSON.stringify({ v: 1, ...payload }));
  const sig = signMessage(vendorSecretKey, body, LICENSE_CONTEXT);
  return `${PREFIX}${b64url(body)}.${b64url(sig)}`;
}

export function verifyLicense(token: string, vendorPublicKey: Uint8Array, opts: { deployment?: string; now?: Date } = {}): LicensePayload {
  if (typeof token !== "string" || !token.startsWith(PREFIX) || token.length > 8192) throw new Error("invalid license");
  const [bodyB64, sigB64, extra] = token.slice(PREFIX.length).split(".");
  if (!bodyB64 || !sigB64 || extra !== undefined) throw new Error("invalid license");
  let body: Uint8Array, sig: Uint8Array;
  try { body = fromB64url(bodyB64); sig = fromB64url(sigB64); } catch { throw new Error("invalid license"); }
  if (!verifySignature(vendorPublicKey, body, sig, LICENSE_CONTEXT)) throw new Error("invalid license");
  let p: LicensePayload;
  try { p = JSON.parse(toText(body)); } catch { throw new Error("invalid license"); }
  const ok = p?.v === 1 && typeof p.id === "string" && /^[A-Za-z0-9._-]{3,64}$/.test(p.id) &&
    typeof p.holder === "string" && p.holder.length > 0 && p.holder.length <= 200 &&
    Number.isInteger(p.max_accounts) && p.max_accounts >= 1 && p.max_accounts <= 1000;
  if (!ok) throw new Error("invalid license");
  const now = opts.now ?? new Date();
  if (p.expires_at !== null) {
    const t = Date.parse(p.expires_at);
    if (!Number.isFinite(t) || t <= now.getTime()) throw new Error("license expired");
  }
  if (p.deployment && opts.deployment && p.deployment !== opts.deployment) throw new Error("license is for a different deployment");
  return p;
}
