// Post-quantum cryptography for Stars and Stripes.
//
//  * Hybrid KEM  = X25519 + ML-KEM-768 (FIPS 203). The session key is secure if EITHER
//    primitive holds, so a future break of one cannot expose data protected by both.
//  * Envelope    = hybrid KEM -> AES-256-GCM (AES-256 stays at ~128-bit strength against Grover).
//  * Signatures  = ML-DSA-65 (FIPS 204), domain-separated by an explicit context string.
//
// Implementation: @noble/post-quantum + @noble/curves (pure JS, no native deps, runs in Deno edge
// functions, Node and Electron). These are not FIPS 140-validated modules. If a buyer requires a
// validated module, swap this file's primitives for OpenSSL 3.5+/liboqs behind the same API.
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { b64url, bs, concat, fromB64url, randomBytes, sha256, toText, utf8 } from "./bytes.ts";

const V1 = 1;
const X_LEN = 32;
const KEM_PK_LEN = 1184;
const KEM_SK_LEN = 2400;
const KEM_CT_LEN = 1088;
const PK_LEN = 1 + X_LEN + KEM_PK_LEN;                 // 1217
const SK_LEN = 1 + X_LEN + KEM_SK_LEN + PK_LEN;        // 3650 (embeds the public key for binding)
const CT_LEN = X_LEN + KEM_CT_LEN;                     // 1120
const IV_LEN = 12;
const ENVELOPE_PREFIX = "sa1:";
const KDF_LABEL = utf8.encode("stars-and-stripes/hybrid-kem/v1");

export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

// ---------------------------------------------------------------- hybrid KEM
export function hybridKeygen(): KeyPair {
  const x = x25519.keygen();
  const k = ml_kem768.keygen();
  const publicKey = concat(Uint8Array.of(V1), x.publicKey, k.publicKey);
  const secretKey = concat(Uint8Array.of(V1), x.secretKey, k.secretKey, publicKey);
  return { publicKey, secretKey };
}

function parsePublic(pk: Uint8Array) {
  if (pk.length !== PK_LEN || pk[0] !== V1) throw new Error("bad hybrid public key");
  return { xpk: pk.subarray(1, 1 + X_LEN), kpk: pk.subarray(1 + X_LEN) };
}

function parseSecret(sk: Uint8Array) {
  if (sk.length !== SK_LEN || sk[0] !== V1) throw new Error("bad hybrid secret key");
  const xsk = sk.subarray(1, 1 + X_LEN);
  const ksk = sk.subarray(1 + X_LEN, 1 + X_LEN + KEM_SK_LEN);
  const pk = sk.subarray(1 + X_LEN + KEM_SK_LEN);
  return { xsk, ksk, pk, ...parsePublic(pk) };
}

/** Combine both shared secrets and bind them to every public value (X-Wing-style transcript binding). */
async function combine(ssX: Uint8Array, ssK: Uint8Array, xpk: Uint8Array, epk: Uint8Array, kpk: Uint8Array, kct: Uint8Array) {
  const info = concat(KDF_LABEL, xpk, epk, await sha256(kpk), await sha256(kct));
  const ikm = await crypto.subtle.importKey("raw", bs(concat(ssX, ssK)), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(KDF_LABEL), info: bs(info) }, ikm, 256);
  return new Uint8Array(bits);
}

export async function hybridEncapsulate(publicKey: Uint8Array): Promise<{ cipherText: Uint8Array; sharedSecret: Uint8Array }> {
  const { xpk, kpk } = parsePublic(publicKey);
  const e = x25519.keygen();
  const ssX = x25519.getSharedSecret(e.secretKey, xpk);
  const { cipherText: kct, sharedSecret: ssK } = ml_kem768.encapsulate(kpk);
  const sharedSecret = await combine(ssX, ssK, xpk, e.publicKey, kpk, kct);
  e.secretKey.fill(0); ssX.fill(0); ssK.fill(0);
  return { cipherText: concat(e.publicKey, kct), sharedSecret };
}

export async function hybridDecapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
  if (cipherText.length !== CT_LEN) throw new Error("bad hybrid ciphertext");
  const { xsk, ksk, xpk, kpk } = parseSecret(secretKey);
  const epk = cipherText.subarray(0, X_LEN);
  const kct = cipherText.subarray(X_LEN);
  const ssX = x25519.getSharedSecret(xsk, epk);
  const ssK = ml_kem768.decapsulate(kct, ksk); // implicit rejection: wrong ct yields a random key, GCM then fails
  const out = await combine(ssX, ssK, xpk, epk, kpk, kct);
  ssX.fill(0); ssK.fill(0);
  return out;
}

// ---------------------------------------------------------------- envelopes
async function aesKey(raw: Uint8Array, usage: "encrypt" | "decrypt") {
  return crypto.subtle.importKey("raw", bs(raw), "AES-GCM", false, [usage]);
}

/** Seal plaintext to a recipient's hybrid public key. `aad` is authenticated, not stored (bind it to row identity). */
export async function sealEnvelope(recipientPublicKey: Uint8Array, plaintext: Uint8Array | string, aad: string): Promise<string> {
  const data = typeof plaintext === "string" ? utf8.encode(plaintext) : plaintext;
  const { cipherText, sharedSecret } = await hybridEncapsulate(recipientPublicKey);
  const iv = randomBytes(IV_LEN);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bs(iv), additionalData: bs(utf8.encode(aad)), tagLength: 128 }, await aesKey(sharedSecret, "encrypt"), bs(data)));
  sharedSecret.fill(0);
  return ENVELOPE_PREFIX + b64url(concat(Uint8Array.of(V1), cipherText, iv, ct));
}

export function isEnvelope(s: unknown): s is string {
  return typeof s === "string" && s.startsWith(ENVELOPE_PREFIX);
}

export async function openEnvelope(secretKey: Uint8Array, envelope: string, aad: string): Promise<Uint8Array> {
  if (!isEnvelope(envelope)) throw new Error("not an envelope");
  const raw = fromB64url(envelope.slice(ENVELOPE_PREFIX.length));
  if (raw.length < 1 + CT_LEN + IV_LEN + 16 || raw[0] !== V1) throw new Error("bad envelope");
  const kemCt = raw.subarray(1, 1 + CT_LEN);
  const iv = raw.subarray(1 + CT_LEN, 1 + CT_LEN + IV_LEN);
  const body = raw.subarray(1 + CT_LEN + IV_LEN);
  const key = await hybridDecapsulate(kemCt, secretKey);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bs(iv), additionalData: bs(utf8.encode(aad)), tagLength: 128 }, await aesKey(key, "decrypt"), bs(body)));
  } catch {
    throw new Error("decryption failed (wrong key, tampered data, or wrong context)");
  } finally {
    key.fill(0);
  }
}

export async function openEnvelopeText(secretKey: Uint8Array, envelope: string, aad: string): Promise<string> {
  return toText(await openEnvelope(secretKey, envelope, aad));
}

// ---------------------------------------------------------------- signatures (ML-DSA-65)
export function signKeygen(): KeyPair {
  const { publicKey, secretKey } = ml_dsa65.keygen();
  return { publicKey, secretKey };
}

export function signMessage(secretKey: Uint8Array, message: Uint8Array, context: string): Uint8Array {
  return ml_dsa65.sign(message, secretKey, { context: utf8.encode(context) });
}

export function verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array, context: string): boolean {
  try {
    return ml_dsa65.verify(signature, message, publicKey, { context: utf8.encode(context) });
  } catch {
    return false;
  }
}

export const PQC_SIZES = { PK_LEN, SK_LEN, CT_LEN, DSA_PK_LEN: 1952, DSA_SIG_LEN: 3309 } as const;
