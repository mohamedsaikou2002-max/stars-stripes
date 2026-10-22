// Client-side session handling for the custom (Argon2id + opaque token) auth service.
// The token lives in sessionStorage: it disappears when the window closes. In the Electron build, swap
// the storage functions for the OS keychain (safeStorage) via the preload bridge.
import { useSyncExternalStore } from "react";

const KEY = "sa.session.v1";
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const PUBLISHABLE = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type SessionUser = { id: string; email: string; role: "admin" | "standard_user" };
type Stored = { token: string; user: SessionUser };

let state: Stored | null = null;
try { const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(KEY) : null; state = raw ? JSON.parse(raw) : null; } catch { state = null; }
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function store(next: Stored | null) {
  state = next;
  try { next ? sessionStorage.setItem(KEY, JSON.stringify(next)) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  emit();
}

export const getToken = () => state?.token ?? null;
export const getUser = () => state?.user ?? null;

export function useSessionUser(): SessionUser | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, getUser, getUser);
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(PUBLISHABLE ? { apikey: PUBLISHABLE, Authorization: `Bearer ${PUBLISHABLE}` } : {}),
    ...(state ? { "x-sa-session": state.token } : {}),
    ...extra,
  };
}

export const fnUrl = (name: string, query?: Record<string, string>) =>
  `${BASE}/${name}${query ? "?" + new URLSearchParams(query).toString() : ""}`;

/** Drop-in for supabase.functions.invoke: returns { data, error }; a 401 signs the user out. */
export async function invokeFn<T = any>(name: string, opts: { body?: unknown; query?: Record<string, string>; method?: string } = {}): Promise<{ data: T | null; error: Error | null }> {
  try {
    const r = await fetch(fnUrl(name, opts.query), {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: authHeaders(),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (r.status === 401 && state) store(null);
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!r.ok) return { data, error: new Error(data?.error ?? `Request failed (${r.status})`) };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error("Network error") };
  }
}

async function authCall(body: Record<string, unknown>) {
  const { data, error } = await invokeFn<{ token: string; user: SessionUser }>("auth", { body });
  if (error || !data) throw error ?? new Error("Authentication failed");
  return data;
}

export async function login(email: string, password: string) {
  const d = await authCall({ action: "login", email, password });
  store({ token: d.token, user: d.user });
}
export async function register(email: string, password: string, license: string) {
  const d = await authCall({ action: "register", email, password, license });
  store({ token: d.token, user: d.user });
}
export async function logout() {
  try { await invokeFn("auth", { body: { action: "logout" } }); } finally { store(null); }
}
export async function restoreSession() {
  if (!state) return;
  const { data, error } = await invokeFn<{ user: SessionUser }>("auth", { body: { action: "me" } });
  if (error || !data) store(null);
}
