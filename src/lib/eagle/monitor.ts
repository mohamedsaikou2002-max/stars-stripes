import { allowed, describe, EventBuffer, eventFor, type TrafficEvent } from "./core";

type Health = { status: string; startedAt: string; checkedAt: string; persistence: string; policy: { backendOrigins: string[]; version: number }; scope: string };
const buffer = new EventBuffer();
let snapshot: { events: TrafficEvent[]; health: Health | null; error: string | null } = { events: [], health: null, error: null };
const listeners = new Set<() => void>();
let origins: string[] = [];
let nativeFetch: typeof fetch;
let installed = false;
let pending: TrafficEvent[] = [];
let flushing = false;
let captureGeneration = 0;
async function backendRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try { return await nativeFetch(path, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const publish = () => { snapshot = { ...snapshot, events: buffer.snapshot() }; listeners.forEach(cb => cb()); };
export const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
export const getSnapshot = () => snapshot;

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  const generation = captureGeneration;
  const batch = pending.splice(0, 100);
  try {
    const r = await backendRequest('/api/monitor/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
    if (!r.ok) throw new Error('Metadata backend rejected the batch');
  } catch {
    // Bound retry state as well as displayed history. Never write metadata to persistent storage.
    if (captureGeneration === generation) pending = [...batch, ...pending].slice(-5000);
  } finally { flushing = false; }
}

function record(event: TrafficEvent) {
  buffer.add(event); pending.push(event); pending = pending.slice(-5000); publish();
  void flush();
}

export async function refreshPolicy() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await nativeFetch('/api/monitor/health', { signal: controller.signal });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const health: Health = await response.json();
    if (health.status !== 'running' || health.policy?.version !== 1 || !Array.isArray(health.policy.backendOrigins)) throw new Error('Backend policy unavailable');
    const backend = health.policy.backendOrigins.map(o => new URL(o));
    if (backend.some(u => u.protocol !== 'https:' || u.username || u.password)) throw new Error('Invalid backend destination policy');
    origins = [window.location.origin, ...backend.map(u => u.origin)];
    // Needed for the same-origin development HMR socket; no additional remote socket origins.
    const socket = new URL(window.location.origin); socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
    origins.push(socket.origin);
    snapshot = { ...snapshot, health, error: null };
  } catch (e) {
    origins = [window.location.origin];
    snapshot = { ...snapshot, health: null, error: e instanceof Error ? e.message : 'Backend unavailable' };
  } finally { clearTimeout(timer); }
  publish(); void flush();
}

export function checkDestination(input: string | URL): URL {
  const url = new URL(input, window.location.href);
  if (!allowed(url, origins)) {
    record(eventFor(url, 'CONNECT', { destination: 'blocked', error: 'blocked' }));
    throw new DOMException('Destination blocked by app policy', 'SecurityError');
  }
  return url;
}

export async function startTrafficMonitor() {
  if (installed) return;
  installed = true;
  nativeFetch = window.fetch.bind(window);
  await refreshPolicy();
  if (snapshot.health) {
    try {
      const r = await backendRequest('/api/monitor/events');
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.events)) data.events.slice(0, 5000).reverse().forEach(event => buffer.add(event));
        publish();
      }
    } catch { /* Current tab collection still works if history retrieval is unavailable. */ }
  }
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = checkDestination(request?.url ?? String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    // Telemetry transport is excluded to prevent recursive collection. It stays same-origin.
    const telemetry = url.origin === window.location.origin && url.pathname.startsWith('/api/monitor/');
    const start = performance.now();
    try {
      const response = await nativeFetch(input, { ...init, redirect: 'error' });
      if (!telemetry) record(eventFor(url, method, { status: response.status, durationMs: performance.now() - start, error: response.ok ? null : 'http' }));
      return response;
    } catch (e) {
      if (!telemetry) record(eventFor(url, method, { durationMs: performance.now() - start, error: 'network' }));
      throw e;
    }
  };

  // CSP provides the browser boundary; hooks additionally produce plain-language blocked events.
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, input: string | URL, ...args: unknown[]) {
    const url = checkDestination(input);
    const started = performance.now();
    this.addEventListener('loadend', () => record(eventFor(url, method.toUpperCase(), {
      status: this.status || null, durationMs: performance.now() - started,
      error: this.status === 0 ? 'network' : this.status >= 400 ? 'http' : null,
    })), { once: true });
    return Reflect.apply(originalOpen, this, [method, input, ...args]);
  } as typeof originalOpen;
  for (const key of ['WebSocket', 'EventSource'] as const) {
    const Original = window[key];
    if (!Original) continue;
    Object.defineProperty(window, key, { configurable: true, value: new Proxy(Original, {
      construct(target, args) {
        const url = checkDestination(String(args[0]));
        const connection = Reflect.construct(target, args);
        connection.addEventListener('open', () => record(eventFor(url, 'CONNECT', {})), { once: true });
        connection.addEventListener('error', () => record(eventFor(url, 'CONNECT', { error: 'network' })), { once: true });
        return connection;
      },
    }) });
  }
  document.addEventListener('securitypolicyviolation', e => {
    if (e.effectiveDirective !== 'connect-src' || !/^https?:|^wss?:/.test(e.blockedURI)) return;
    try { record(eventFor(new URL(e.blockedURI), 'CONNECT', { destination: 'blocked', error: 'blocked' })); } catch { /* not a network URI */ }
  });
  setInterval(() => void flush(), 2000);
}

export async function clearEvents() {
  captureGeneration++; pending = [];
  // Finish any in-flight upload before deleting backend history.
  while (flushing) await new Promise(resolve => setTimeout(resolve, 20));
  const r = await backendRequest('/api/monitor/events', { method: 'DELETE' });
  if (!r.ok) throw new Error('Could not clear backend history');
  buffer.clear(); publish();
}

export function testBlockedDestination() {
  try { checkDestination('https://blocked-destination.invalid/'); } catch { /* blocked before network I/O */ }
}

export async function exportReport() {
  const report = { generatedAt: new Date().toISOString(), scope: snapshot.health?.scope ?? 'Backend unavailable',
    appVersion: '0.1.0', transport: { tlsVersion: null, keyExchange: null, certificatePinned: null, serverSignatureVerified: null },
    events: snapshot.events.map(event => ({ ...event, description: describe(event).text })) };
  const contents = JSON.stringify(report, null, 2);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contents));
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const blob = new Blob([JSON.stringify({ report, sha256, hashScope: 'UTF-8 JSON.stringify(report, null, 2)' }, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = href; link.download = 'eagle-view-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}
