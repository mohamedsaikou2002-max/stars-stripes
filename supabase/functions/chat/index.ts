import { buildCivicPrompt, selectPassages, type AccountContext, type Passage } from "./corpus.ts";
import { gate, serviceClient } from "../_shared/gate.ts";
import { fieldAad, openField, sealField } from "../_shared/vault.ts";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

import { corsHeaders } from "../_shared/http.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = Deno.env.get("DEFAULT_MODEL") ?? "claude-sonnet-4-5";
const MAX_HISTORY_CHARS = 32_000;
const REQUEST_TIMEOUT_MS = 110_000;

type MemoryRow = { role: string; content: string };

type ChatBody = {
  account?: AccountContext | null;
  message?: string;
  jurisdiction?: string;
  sourcePassages?: Passage[];
  userId?: string;
  sessionId?: string;
  archiveMode?: boolean;
  inquiryMode?: string;
  pemfContext?: {
    coherenceScore?: number;
    recoveryState?: string;
    hrvScore?: number;
  } | null;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function trimHistory(rows: MemoryRow[]): MemoryRow[] {
  let used = 0;
  const kept: MemoryRow[] = [];

  for (let i = rows.length - 1; i >= 0; i--) {
    const size = rows[i].content.length;
    if (used + size > MAX_HISTORY_CHARS) break;
    used += size;
    kept.unshift(rows[i]);
  }

  return kept;
}

function systemPrompt(body: ChatBody): string {
  return buildCivicPrompt(body.inquiryMode, body.sourcePassages ?? [], body.jurisdiction, body.account);
}

async function askGeminiNative(body: ChatBody, history: MemoryRow[], key: string, model: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const contents = trimHistory(history)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  contents.push({ role: "user", parts: [{ text: body.message!.trim() }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(body) }] },
        contents,
        generationConfig: { temperature: 0.7 },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Native Gemini (${model}) error:`, res.status, text);
      throw new Error(text || `Gemini returned ${res.status}`);
    }
    const data = JSON.parse(text);
    const out = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim();
    return out || "I couldn't generate a response.";
  } finally {
    clearTimeout(timeout);
  }
}

async function askGeminiGateway(body: ChatBody, history: MemoryRow[]): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const messages = [
    { role: "system", content: systemPrompt(body) },
    ...trimHistory(history)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message!.trim() },
  ];

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", temperature: 0.7, messages }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("Gateway Gemini error:", res.status, text);
      throw new Error(text || `Gemini returned ${res.status}`);
    }
    const data = JSON.parse(text);
    return (data.choices?.[0]?.message?.content ?? "").trim() || "I couldn't generate a response.";
  } finally {
    clearTimeout(timeout);
  }
}

async function askGemini(body: ChatBody, history: MemoryRow[]): Promise<string> {
  const userKey = Deno.env.get("GEMINI_API_KEY");
  if (userKey) {
    const models = [
      Deno.env.get("GEMINI_MODEL"),
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.5-pro",
    ].filter((m, i, a) => !!m && a.indexOf(m) === i) as string[];

    for (const model of models) {
      try {
        return await askGeminiNative(body, history, userKey, model);
      } catch (err) {
        console.error(`User Gemini ${model} failed:`, (err as Error).message?.slice(0, 200));
      }
    }
    console.error("All user Gemini models exhausted; trying Lovable gateway");
  }
  return await askGeminiGateway(body, history);
}

async function askAnthropic(body: ChatBody, history: MemoryRow[]): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY missing");
    (err as any).fallback = true;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const messages = trimHistory(history)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  messages.push({ role: "user", content: body.message!.trim() });

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.7,
        system: systemPrompt(body),
        messages,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("Anthropic error:", res.status, text);
      const lower = text.toLowerCase();
      const isCreditOrAuth =
        res.status === 401 ||
        res.status === 402 ||
        res.status === 429 ||
        lower.includes("credit balance") ||
        lower.includes("quota") ||
        lower.includes("billing");
      if (isCreditOrAuth) {
        const err = new Error("anthropic_unavailable");
        (err as any).fallback = true;
        throw err;
      }
      throw new Error(text || `Anthropic returned ${res.status}`);
    }

    const data = JSON.parse(text);
    const out = (data.content ?? [])
      .map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
    if (!out) {
      console.error("Empty Anthropic response. stop_reason:", data.stop_reason, "content:", JSON.stringify(data.content));
      if (data.stop_reason === "refusal") {
        return "[Stars and Stripes note: the underlying model declined to answer that prompt. Try rephrasing, narrowing scope, or framing it as analysis/research.]";
      }
    }
    return out || "I couldn't generate a response.";
  } finally {
    clearTimeout(timeout);
  }
}

async function askWithFallback(body: ChatBody, history: MemoryRow[]): Promise<string> {
  // Gemini-first (user's GEMINI_API_KEY native, then Lovable gateway). Anthropic only as last resort.
  try {
    return await askGemini(body, history);
  } catch (err) {
    console.error("Gemini path failed, trying Anthropic as last resort:", (err as Error).message?.slice(0, 200));
    try {
      return await askAnthropic(body, history);
    } catch {
      throw err;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_CHARS = 20_000;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const session = await gate(req);
  if (session instanceof Response) return session;
  const userId = session.userId; // from the session only; any userId in the body is ignored

  try {
    const body = (await req.json()) as ChatBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) return json({ error: "message is required" }, 400);
    if (message.length > MAX_MESSAGE_CHARS) return json({ error: "message is too long" }, 413);

    const supabase = serviceClient();
    const sessionId = body.sessionId && UUID_RE.test(body.sessionId) ? body.sessionId : crypto.randomUUID();
    const contentAad = fieldAad("belicia_memory", "content", userId);

    const { data: rows } = await supabase
      .from("belicia_memory")
      .select("role, content")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(80);
    const previous: MemoryRow[] = [];
    for (const r of (rows ?? []) as MemoryRow[]) {
      try { previous.push({ role: r.role, content: await openField(r.content, contentAad) }); } catch { /* skip undecryptable rows */ }
    }

    // Account profile shapes voice and priorities (never trusted as instructions).
    const { data: prof } = await supabase.from("belicia_profile")
      .select("display_name, office_role, jurisdiction, language_register, response_depth, active_missions, strategic_context")
      .eq("user_id", userId).maybeSingle();
    body.account = (prof as AccountContext | null) ?? null;

    // Never trust request-supplied passages. Base snapshots work without a database import.
    body.sourcePassages = body.archiveMode === false ? [] : selectPassages(message, body.inquiryMode ?? "leadership");
    if (body.archiveMode !== false) {
      const { data: imported, error } = await supabase.rpc("sa_records_search", {
        p_user: userId,
        p_query: message.slice(0, 1000),
        p_jurisdiction: body.jurisdiction || null,
        p_limit: 4,
      });
      if (!error && Array.isArray(imported)) body.sourcePassages = [...body.sourcePassages, ...(imported as Passage[])];
    }
    const response = await askWithFallback(body, previous);

    const common = {
      user_id: userId,
      session_id: sessionId,
      inquiry_mode: body.inquiryMode ?? null,
      memory_type: body.archiveMode ? "archive" : "exchange",
      pemf_coherence_at_time: body.pemfContext?.coherenceScore ?? null,
    };
    const { error: insErr } = await supabase.from("belicia_memory").insert([
      { ...common, role: "user", content: await sealField(message, contentAad) },
      { ...common, role: "assistant", content: await sealField(response, contentAad) },
    ]);
    if (insErr) console.error("memory insert failed:", insErr.message);

    // Metadata only (never content) goes in the tamper-evident audit trail.
    await supabase.rpc("sa_audit", { p_user: userId, p_action: "chat", p_detail: { session: sessionId, mode: body.inquiryMode ?? null } });

    return json({ response, sessionId, sources: body.sourcePassages.map(({ text, ...source }) => source), coverage: "Selected snapshots and imported passages; not comprehensive legal coverage." });
  } catch (error) {
    console.error("chat error:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.name === "AbortError") return json({ error: "The request timed out." }, 504);
    return json({ error: "The advisor could not complete that request." }, 500);
  }
});
