// Field-level encryption for stored sensitive content (conversation history etc.).
// Each value is sealed to the deployment's hybrid (X25519 + ML-KEM-768) public key with AES-256-GCM,
// and authenticated against its table/column/owner so ciphertext cannot be replayed into another context.
// Keys come from the secret store: VAULT_PUBLIC_KEY (b64url) and VAULT_SECRET_KEY (b64url, read path only).
import { fromB64url } from "./bytes.ts";
import { isEnvelope, openEnvelopeText, sealEnvelope } from "./pqc.ts";

const env = (k: string): string | undefined => {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get?.(k) ?? g.process?.env?.[k];
};

export const fieldAad = (table: string, column: string, userId: string) => `sa/${table}.${column}/${userId}`;

export function vaultConfigured(): boolean {
  return Boolean(env("VAULT_PUBLIC_KEY") && env("VAULT_SECRET_KEY"));
}

export async function sealField(plaintext: string, aad: string): Promise<string> {
  const pk = env("VAULT_PUBLIC_KEY");
  if (!pk) {
    if (env("SA_ALLOW_PLAINTEXT") === "true") return plaintext; // local development only
    throw new Error("Vault is not configured (VAULT_PUBLIC_KEY). Refusing to store sensitive content unencrypted.");
  }
  return sealEnvelope(fromB64url(pk), plaintext, aad);
}

export async function openField(value: string, aad: string): Promise<string> {
  if (!isEnvelope(value)) return value; // legacy/dev plaintext row
  const sk = env("VAULT_SECRET_KEY");
  if (!sk) throw new Error("Vault secret key is not configured (VAULT_SECRET_KEY).");
  return openEnvelopeText(fromB64url(sk), value, aad);
}
