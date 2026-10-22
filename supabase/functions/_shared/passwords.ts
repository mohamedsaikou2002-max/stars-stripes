// Argon2id password hashing (hash-wasm, WebAssembly: runs in Deno edge functions and Node).
// Parameters exceed the OWASP minimum (m=19 MiB,t=2). Tune ARGON2_MEMORY_KIB / ARGON2_ITERATIONS per host;
// stored hashes embed their own parameters, so raising them later does not break existing accounts.
import { argon2id, argon2Verify } from "hash-wasm";
import { b64url, randomBytes, utf8 } from "./bytes.ts";

const env = (k: string): string | undefined => {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get?.(k) ?? g.process?.env?.[k];
};

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export function checkPasswordPolicy(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if ([...pw].length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters (a passphrase works well).`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (/^(.)\1+$/.test(pw)) return "Password is too repetitive.";
  return null;
}

/** Optional server-side pepper (HMAC-SHA256) so a database-only leak cannot be brute-forced offline. */
async function prehash(password: string): Promise<string> {
  const pepper = env("PASSWORD_PEPPER");
  const pw = password.normalize("NFKC");
  if (!pepper) return pw;
  const key = await crypto.subtle.importKey("raw", utf8.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(pw))));
}

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password: await prehash(password),
    salt: randomBytes(16),
    parallelism: 1,
    iterations: Number(env("ARGON2_ITERATIONS") ?? 3),
    memorySize: Number(env("ARGON2_MEMORY_KIB") ?? 65536),
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: await prehash(password), hash: encoded });
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Burn equivalent CPU for unknown accounts so response time does not reveal which emails exist. */
export async function dummyVerify(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password-for-timing-only");
  await verifyPassword(password, await dummy);
}
