import { authHeaders, invokeFn } from "@/lib/session";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, backendConfigured } from "@/integrations/supabase/client";
import { CivicOrb } from "@/components/CivicOrb";
import { CIVIC_MODES, civicMode, type CivicMode } from "../../supabase/functions/_shared/civic";
import { TopNav } from "@/components/TopNav";
import { usePemfState } from "@/hooks/usePemfState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Mic, MicOff, Send, Trash2, Volume2, VolumeX, Archive, Plus, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { CivicIntelCompressor } from "@/components/IntelCompressor/CivicIntelCompressor";

type Source = { id: string; title: string; url: string; retrieved_at: string };
type Msg = { sources?: Source[]; role: "user" | "assistant"; content: string; created_at?: string };

// Web Speech API typing
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const Index = () => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [useArchive, setUseArchive] = useState(true);
  const [mode, setMode] = useState<CivicMode>(() => civicMode(new URLSearchParams(window.location.search).get("mode") ?? undefined).id);
  const [jurisdiction, setJurisdiction] = useState("federal");
  const [intensity, setIntensity] = useState(0);
  const { pemf, connected: pemfConnected } = usePemfState("default");
  const [showCompressor, setShowCompressor] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => {
    const saved = localStorage.getItem("stars_stripes_session_id");
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem("stars_stripes_session_id", fresh);
    return fresh;
  });
  const [sessions, setSessions] = useState<Array<{ session_id: string; preview: string; last: string }>>([]);
  const [showSessions, setShowSessions] = useState(false);

  const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;

  const loadSessions = useCallback(async () => {
    if (!backendConfigured) return;
    const r = await fetch(`${SUPA_URL}/functions/v1/memory?action=sessions`, { headers: authHeaders() });
    if (r.ok) {
      const j = await r.json();
      setSessions(j.sessions ?? []);
    }
  }, []);

  const loadSessionMessages = useCallback(async (sid: string) => {
    if (!backendConfigured) return;
    const r = await fetch(`${SUPA_URL}/functions/v1/memory?action=recent&session_id=${sid}`, { headers: authHeaders() });
    if (r.ok) {
      const j = await r.json();
      setMessages(j.messages ?? []);
    }
  }, []);

  const newChat = useCallback(() => {
    const fresh = crypto.randomUUID();
    localStorage.setItem("stars_stripes_session_id", fresh);
    setSessionId(fresh);
    setMessages([]);
    setShowSessions(false);
    toast.success("New chat started");
    loadSessions();
  }, [loadSessions]);

  const switchSession = useCallback((sid: string) => {
    localStorage.setItem("stars_stripes_session_id", sid);
    setSessionId(sid);
    loadSessionMessages(sid);
    setShowSessions(false);
  }, [loadSessionMessages]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setShowCompressor((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const recogRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const speakWithBrowser = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
    const voices = window.speechSynthesis.getVoices();
    const feminine = voices.find(v => /samantha|victoria|karen|tessa|zira|female|google uk english female/i.test(v.name))
      || voices.find(v => /en[-_]/i.test(v.lang) && /female/i.test(v.name))
      || voices.find(v => /en[-_]/i.test(v.lang));
    if (feminine) utterance.voice = feminine;
    utterance.rate = 0.95;
    utterance.pitch = 1.15;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  // load history for current session
  useEffect(() => {
    loadSessionMessages(sessionId);
    loadSessions();
  }, [sessionId, loadSessionMessages, loadSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages, sending]);

  const speak = useCallback(async (text: string) => {
    if (!voiceOn || !text) return;
    try {
      setSpeaking(true);
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tts`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ text }),
        },
      );
      if (!r.ok) throw new Error(`TTS failed (${r.status})`);
      const contentType = r.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        await r.json();
        if (speakWithBrowser(text)) return;
        throw new Error("Voice playback unavailable");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current?.pause();
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (e) {
      console.error(e);
      if (!speakWithBrowser(text)) setSpeaking(false);
    }
  }, [voiceOn, speakWithBrowser]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    if (!backendConfigured) { toast.info("Connect a dedicated backend to enable the advisor."); return; }
    setSending(true);
    setIntensity(0.6);
    setMessages(m => [...m, { role: "user", content: message }]);
    setInput("");

    try {
      const { data, error } = await invokeFn("chat", {
        body: {
          message,
          sessionId,
          archiveMode: useArchive,
          inquiryMode: mode,
          jurisdiction,
          pemfContext: pemf ? {
            coherenceScore: pemf.coherenceScore,
            recoveryState: pemf.recoveryState,
            hrvScore: pemf.hrvScore,
          } : null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const reply = (data as any).response as string;
      setMessages(m => [...m, { role: "assistant", content: reply, sources: (data as { sources?: Source[] }).sources ?? [] }]);
      speak(reply);
      loadSessions();
    } catch (e: any) {
      toast.error(e.message || "Stars and Stripes hit an error");
    } finally {
      setSending(false);
      setIntensity(0);
    }
  }, [sending, useArchive, mode, jurisdiction, speak, sessionId, pemf, loadSessions]);

  // voice input
  const toggleListen = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast.error("Speech recognition not supported in this browser"); return; }
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const recog = new SR();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = "en-US";
    recog.onstart = () => { setListening(true); setIntensity(0.4); };
    recog.onresult = (ev: any) => {
      let txt = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        txt += ev.results[i][0].transcript;
      }
      setInput(txt);
      setIntensity(0.4 + Math.min(0.5, txt.length / 80));
      if (ev.results[ev.results.length - 1].isFinal) {
        recog.stop();
        send(txt);
      }
    };
    recog.onerror = () => { setListening(false); setIntensity(0); };
    recog.onend = () => { setListening(false); setIntensity(0); };
    recogRef.current = recog;
    recog.start();
  }, [listening, send]);

  const clearMemory = async () => {
    if (!confirm("Wipe all of Stars and Stripes's memory?")) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory?action=clear`;
    await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    setMessages([]);
    toast.success("Memory cleared");
  };

  const stopSpeaking = () => {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  return (
    <main className="min-h-screen flex flex-col text-foreground">
      <header className="flex items-center justify-between px-6 py-4 bg-glass border-b border-slate-900/10 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-[0.3em] text-glow">STARS &amp; STRIPES</h1>
          <p className="text-xs text-slate-900/60 tracking-widest mt-1">PUBLIC SERVICE · KNOWLEDGE · SOUND JUDGMENT</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TopNav />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as CivicMode)}
            className="bg-transparent border border-slate-900/20 text-slate-900/80 text-xs px-2 py-1 rounded-md focus:outline-none focus:border-slate-900/60"
            title="Inquiry mode"
          >
            {CIVIC_MODES.map(m => <option key={m.id} value={m.id} className="bg-white">{m.label}</option>)}
          </select>
          <input aria-label="Jurisdiction" title="Jurisdiction; use a state name for state-law research" value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} placeholder="Jurisdiction" className="border rounded-md px-2 py-1 text-xs w-36 bg-white" />
          <label className="flex items-center gap-2 text-xs text-slate-900/70">
            <Archive className="w-3.5 h-3.5" />
            Source grounding
            <Switch checked={useArchive} onCheckedChange={setUseArchive} />
          </label>
          <button
            onClick={() => setShowCompressor(true)}
            className="text-[11px] tracking-[0.3em] border border-slate-900/30 text-slate-900/80 px-3 py-1 hover:bg-white hover:text-black transition"
            title="Intel Compressor (Ctrl/Cmd+I)"
          >
            ⊕ INTEL
          </button>
          <button
            onClick={newChat}
            className="flex items-center gap-1 text-[11px] tracking-[0.2em] border border-slate-900/30 text-slate-900/80 px-2 py-1 hover:bg-white hover:text-black transition"
            title="Start a fresh chat"
          >
            <Plus className="w-3 h-3" /> NEW
          </button>
          <div className="relative">
            <button
              onClick={() => { setShowSessions(v => !v); if (!showSessions) loadSessions(); }}
              className="flex items-center gap-1 text-[11px] tracking-[0.2em] border border-slate-900/30 text-slate-900/80 px-2 py-1 hover:bg-white hover:text-black transition"
              title="Switch chat"
            >
              <MessageSquare className="w-3 h-3" /> CHATS
            </button>
            {showSessions && (
              <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto bg-white border border-slate-900/30 z-50 shadow-xl">
                {sessions.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-900/60">No prior chats</div>
                )}
                {sessions.map(s => (
                  <button
                    key={s.session_id}
                    onClick={() => switchSession(s.session_id)}
                    className={`w-full text-left px-3 py-2 text-xs border-b border-slate-900/10 hover:bg-slate-100 transition ${s.session_id === sessionId ? "bg-slate-100 text-slate-900" : "text-slate-900/70"}`}
                  >
                    <div className="truncate">{s.preview || "(empty)"}</div>
                    <div className="text-[10px] text-slate-900/60 mt-0.5">{new Date(s.last).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setVoiceOn(v => !v)} title="Toggle voice">
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={clearMemory} title="Clear memory">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <section className="grid lg:grid-cols-[1fr_minmax(0,520px)] flex-1 gap-0">
        {/* Orb */}
        <div className="relative civic-gradient h-[40vh] lg:h-auto min-h-[300px]">
          <CivicOrb
            intensity={intensity}
            speaking={speaking || sending}
            pemfCoherence={pemf?.coherenceScore ?? null}
            pemfConnected={pemfConnected}
          />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center pointer-events-none">
            <p className="text-xs tracking-[0.4em] text-slate-900/60">
              {sending ? "THINKING…" : speaking ? "SPEAKING…" : listening ? "LISTENING…" : "READY"}
            </p>
          </div>
          {speaking && (
            <button
              onClick={stopSpeaking}
              className="absolute top-6 right-6 text-xs px-3 py-1 bg-glass rounded-full border border-slate-900/20 hover:border-slate-900/60 transition"
            >
              Stop
            </button>
          )}
        </div>

        {/* Chat */}
        <aside className="flex flex-col bg-glass border-l border-slate-900/10 max-h-[60vh] lg:max-h-none">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-900/60 text-sm pt-12">
                <p>{civicMode(mode).description}</p>
                <button type="button" onClick={() => setInput(civicMode(mode).question)} className="mt-5 border rounded-xl p-4 text-left text-blue-900 civic-gradient hover:border-blue-500">{civicMode(mode).question}<span className="block text-xs mt-3">Use this question →</span></button>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-slate-100 border border-slate-900/30 text-slate-900"
                      : "bg-slate-100 border border-slate-900/15 text-slate-900/90"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {!!m.sources?.length && <details className="mt-3 text-xs border-t pt-2"><summary className="cursor-pointer text-blue-800">Retrieved sources ({m.sources.length})</summary><ul className="mt-2 space-y-2">{m.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer" className="text-blue-800 underline">{source.title}</a><span className="block text-slate-600">{source.id} · Snapshot {source.retrieved_at.slice(0,10)}</span></li>)}</ul></details>}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="px-4 py-2.5 rounded-2xl bg-slate-100 border border-slate-900/15">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-glow" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-glow" style={{ animationDelay: "0.2s" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-glow" style={{ animationDelay: "0.4s" }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="p-4 border-t border-slate-900/10 flex gap-2"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleListen}
              className={listening ? "text-slate-900 border-glow" : "text-slate-900/80"}
              title={listening ? "Stop listening" : "Voice input"}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about leadership, law, history, or a policy trade-off…"
              className="bg-transparent border-slate-900/20 focus-visible:ring-blue-600/40 text-slate-900 placeholder:text-slate-900/60"
              disabled={sending}
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !input.trim()}
              className="bg-slate-100 hover:bg-slate-100 border border-slate-900/30 text-slate-900"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </aside>
      </section>
      {showCompressor && <CivicIntelCompressor onClose={() => setShowCompressor(false)} />}
    </main>
  );
};

export default Index;
