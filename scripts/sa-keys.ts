#!/usr/bin/env node
// Key and license tooling (run with Node 22.18+; no build step).
//   node scripts/sa-keys.ts vendor-keygen  [--out vendor-license-signing.key]
//   node scripts/sa-keys.ts issue-license  --key vendor-license-signing.key --id SAS-2026-0001 --holder "Office of the Governor" --seats 5 [--expires 2036-01-01] [--deployment dep-1]
//   node scripts/sa-keys.ts vault-keygen
//   node scripts/sa-keys.ts secrets
// The vendor SECRET key never leaves your machine; only the public key is deployed.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { b64url, fromB64url, randomBytes } from "../supabase/functions/_shared/bytes.ts";
import { hybridKeygen, signKeygen } from "../supabase/functions/_shared/pqc.ts";
import { issueLicense, verifyLicense } from "../supabase/functions/_shared/license.ts";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const need = (name: string) => { const v = flag(name); if (!v) { console.error(`missing --${name}`); process.exit(2); } return v; };

switch (cmd) {
  case "vendor-keygen": {
    const out = flag("out") ?? "vendor-license-signing.key";
    const k = signKeygen();
    writeFileSync(out, b64url(k.secretKey) + "\n", { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(`Signing key written to ${out} (keep OFFLINE; back it up; never commit it).`);
    console.log("\nSet on each deployment:\n  supabase secrets set VENDOR_LICENSE_PUBLIC_KEY=" + b64url(k.publicKey));
    break;
  }
  case "issue-license": {
    const sk = fromB64url(readFileSync(need("key"), "utf8").trim());
    const expires = flag("expires");
    const token = issueLicense(sk, {
      id: need("id"), holder: need("holder"), max_accounts: Number(need("seats")),
      issued_at: new Date().toISOString().slice(0, 10),
      expires_at: expires ? new Date(expires).toISOString() : null,
      ...(flag("deployment") ? { deployment: flag("deployment") } : {}),
    });
    const pub = flag("pub");
    if (pub) verifyLicense(token, fromB64url(pub)); // optional self-check
    console.log(token);
    break;
  }
  case "vault-keygen": {
    const k = hybridKeygen();
    console.log("Run (values are secrets; store the SECRET key in an offline/HSM-backed store too):\n");
    console.log(`supabase secrets set VAULT_PUBLIC_KEY=${b64url(k.publicKey)}`);
    console.log(`supabase secrets set VAULT_SECRET_KEY=${b64url(k.secretKey)}`);
    break;
  }
  case "secrets": {
    console.log(`supabase secrets set PASSWORD_PEPPER=${b64url(randomBytes(32))}`);
    console.log(`supabase secrets set CRON_SECRET=${b64url(randomBytes(32))}`);
    break;
  }
  default:
    console.error("commands: vendor-keygen | issue-license | vault-keygen | secrets");
    process.exit(2);
}
