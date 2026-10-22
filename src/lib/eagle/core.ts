export type TrafficEvent = {
  id: string; ts: string; host: string; method: string; pathClass: string;
  status: number | null; durationMs: number; destination: "allowlisted" | "blocked";
  error: "blocked" | "network" | "http" | null;
};

export const MAX_EVENTS = 5000;
const FUNCTIONS = new Set(["auth", "chat", "memory", "daily-brief", "tts", "intel-archive", "intel-distill", "mirofish", "game-theory", "pod-room"]);

// Never retain raw paths, queries, headers, or payloads. Only fixed route categories survive.
export function pathClass(path: string): string {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "functions" && parts[1] === "v1" && FUNCTIONS.has(parts[2])) return `/functions/v1/${parts[2]}`;
  return path === "/" ? "/" : "/[redacted]";
}

export function allowed(url: URL, origins: readonly string[]): boolean {
  return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
    !url.username && !url.password && origins.includes(url.origin);
}

export class EventBuffer {
  private items: TrafficEvent[] = [];
  private limit: number;
  constructor(limit = MAX_EVENTS) { this.limit = limit; }
  add(event: TrafficEvent) { this.items.push(event); if (this.items.length > this.limit) this.items.shift(); }
  snapshot() { return this.items.slice().reverse(); }
  clear() { this.items = []; }
}

export function describe(event: TrafficEvent): { text: string; severity: "info" | "warn" | "alert" } {
  if (event.destination === "blocked") return { text: "Blocked a request to an address outside this app's destination policy.", severity: "alert" };
  if (event.error === "network") return { text: "The request failed. Check connectivity and the backend's availability.", severity: "warn" };
  if (event.error === "http") return { text: `The server returned an error (${event.status}).`, severity: "warn" };
  if (event.status === null) return { text: "Connection opened. Delivery and transport security have not been verified.", severity: "info" };
  return { text: `The destination policy allowed this request. Server response: ${event.status}. Transport security details are not verified.`, severity: "info" };
}

export function eventFor(url: URL, method: string, result: Partial<TrafficEvent>): TrafficEvent {
  return {
    id: crypto.randomUUID(), ts: new Date().toISOString(), host: url.hostname,
    method: /^[A-Z]{1,12}$/.test(method) ? method : "OTHER", pathClass: pathClass(url.pathname),
    status: null, durationMs: 0, destination: "allowlisted", error: null, ...result,
  };
}
