import { useEffect, useState, useSyncExternalStore } from 'react';
import { TopNav } from '@/components/TopNav';
import { describe } from '@/lib/eagle/core';
import { clearEvents, exportReport, getSnapshot, refreshPolicy, subscribe, testBlockedDestination } from '@/lib/eagle/monitor';

const layers = [
  ['7 · Application', 'Destination checks for app fetch, XHR, WebSocket, and EventSource. Browser CSP restricts connections.', 'Other applications and OS traffic are outside this monitor.'],
  ['6 · Presentation', 'Browser-managed encryption.', 'TLS version, negotiated key exchange, certificate pinning and PQ signatures: Not verified.'],
  ['5 · Session', 'Connection outcomes and HTTP status where the browser exposes them.', 'Database login, persistent sessions, and server identity verification are not active in this dashboard.'],
  ['4 · Transport', 'Request duration and connection errors.', 'No TCP packet capture, port blocking, or device-wide transport control.'],
  ['3 · Network', 'Destination host from app requests.', 'No routing or device-wide IP enforcement. Destination IP and VPN status: Unknown.'],
  ['2 · Data link', 'No controls in this browser build.', 'Wi-Fi security and network adapter posture: Unknown.'],
  ['1 · Physical', 'No controls in this browser build.', 'Physical connections and device hardware: Unknown.'],
];

export default function EagleView() {
  const { events, health, error } = useSyncExternalStore(subscribe, getSnapshot);
  const [tab, setTab] = useState('Live feed');
  const [query, setQuery] = useState('');
  const [warnings, setWarnings] = useState(false);
  const [paused, setPaused] = useState<null | typeof events>(null);
  const [actionError, setActionError] = useState('');
  useEffect(() => { const timer = setInterval(() => void refreshPolicy(), 5000); return () => clearInterval(timer); }, []);
  const visible = (paused ?? events).filter(e => (!warnings || describe(e).severity !== 'info') && `${e.host} ${e.pathClass} ${e.method}`.toLowerCase().includes(query.toLowerCase()));
  const blocked = events.filter(e => e.destination === 'blocked').length;
  const failed = events.filter(e => e.error && e.error !== 'blocked').length;
  const action = async (fn: () => unknown) => { setActionError(''); try { await fn(); } catch { setActionError('The action failed. Check the local backend and try again.'); } };
  return <main className="min-h-screen bg-white text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-5 border-b p-6"><div><p className="text-xs tracking-[.3em] text-blue-800">STARS AND STRIPES</p><h1 className="text-3xl font-semibold mt-2">EAGLE VIEW</h1></div><TopNav /></header>
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <section className="rounded-2xl border bg-slate-50 p-5" aria-live="polite"><h2 className="text-lg font-semibold">{health ? 'Traffic backend connected' : 'Traffic backend unavailable'}</h2>
        <p className="mt-2 text-sm">{health ? 'App destination policy loaded. Requests outside the allowed origins are blocked.' : `Remote destinations are blocked until the policy is available. ${error ?? ''}`}</p>
        <p className="mt-2 text-sm text-slate-600">This app only · In-memory metadata · Database disabled for this dashboard. System-wide OSI controls are not active.</p>
        <p className="mt-2 text-xs">Last backend check: {health ? new Date(health.checkedAt).toLocaleTimeString() : 'Not verified'}</p>
      </section>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[['Recorded events', events.length], ['Blocked attempts', blocked], ['Failed requests', failed], ['TLS / PQ details', 'Not verified']].map(([label,value]) => <div className="border rounded-xl p-4 min-w-0" key={label}><p className="text-xs text-slate-600">{label}</p><p className="mt-2 font-semibold break-words">{value}</p></div>)}</div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Traffic views">{['Live feed', 'Security summary', 'OSI layers'].map(t => <button className={`rounded-lg px-4 py-2 border ${tab === t ? 'bg-blue-900 text-white' : ''}`} key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Live feed' && <section className="space-y-4" aria-label="Live feed">
        <div className="flex flex-wrap gap-3 items-center"><input className="border rounded-lg p-2 flex-1 min-w-40" placeholder="Search host or route category" aria-label="Search traffic" value={query} onChange={e => setQuery(e.target.value)} /><label className="text-sm"><input type="checkbox" checked={warnings} onChange={e => setWarnings(e.target.checked)} /> Warnings only</label><button className="border rounded-lg p-2" onClick={() => setPaused(paused ? null : events.slice())}>{paused ? 'Resume feed' : 'Pause feed'}</button></div>
        <p className="text-xs text-slate-600">{paused ? 'Display paused; collection continues.' : 'Newest first.'} Up to 5,000 events. Request bodies, headers, and query strings are never collected. Monitoring API calls are excluded to prevent recursive logging.</p>
        {!visible.length && <p className="border rounded-xl p-6 text-slate-600">No matching traffic yet. Run a backend check or test a blocked destination below.</p>}
        <ol className="space-y-3">{visible.slice(0, 150).map(e => { const d = describe(e); return <li key={e.id} className={`border rounded-xl p-4 ${d.severity === 'alert' ? 'border-red-400 bg-red-50' : d.severity === 'warn' ? 'border-amber-400 bg-amber-50' : ''}`}><div className="flex justify-between gap-3 flex-wrap"><strong className="break-all">{e.host}</strong><time className="text-xs text-slate-600">{new Date(e.ts).toLocaleTimeString()}</time></div><p className="text-sm mt-2">{d.text}</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Technical details</summary><pre className="overflow-auto mt-2">{JSON.stringify(e, null, 2)}</pre></details></li>; })}</ol>
        {visible.length > 150 && <p className="text-sm">Showing the newest 150 matching events. Export includes the retained history.</p>}
      </section>}
      {tab === 'Security summary' && <section className="border rounded-xl p-5 space-y-4"><h2 className="text-lg font-semibold">Measured state</h2><dl className="grid sm:grid-cols-2 gap-3 text-sm"><dt>Backend status</dt><dd>{health ? 'Responding' : 'Unavailable'}</dd><dt>Allowed backend origins</dt><dd className="break-all">{health?.policy.backendOrigins.join(', ') || 'None loaded'}</dd><dt>TLS version / key exchange</dt><dd>Not verified</dd><dt>Certificate pin / PQ signature</dt><dd>Not verified</dd><dt>App / update signature</dt><dd>Not verified · browser development build</dd><dt>Retention</dt><dd>In memory, until cleared or restarted; maximum 5,000 events</dd></dl><p className="text-sm text-slate-600">HTTPS destinations alone do not prove a negotiated TLS group, pin match, or post-quantum server identity. No reassuring badge is inferred from an unknown measurement.</p></section>}
      {tab === 'OSI layers' && <section className="overflow-x-auto"><table className="w-full text-sm text-left border"><caption className="text-left mb-3">What this browser build can enforce and what it cannot measure</caption><thead className="bg-slate-100"><tr>{['Layer', 'App control or observation', 'Limits'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{layers.map(([name,control,limit]) => <tr className="border-t" key={name}><th className="p-3 align-top min-w-32">{name}</th><td className="p-3 align-top min-w-48">{control}</td><td className="p-3 align-top min-w-56">{limit}</td></tr>)}</tbody></table></section>}
      <div className="flex flex-wrap gap-3"><button className="bg-blue-900 text-white rounded-lg px-4 py-2" onClick={() => action(async () => { await fetch('/api/monitor-check'); })}>Check backend request</button><button className="border rounded-lg px-4 py-2" onClick={testBlockedDestination}>Test destination blocking</button><button className="border rounded-lg px-4 py-2" onClick={() => action(exportReport)}>Export JSON report</button><button className="border rounded-lg px-4 py-2" onClick={() => action(async () => { await clearEvents(); setPaused(null); })}>Clear history</button></div>
      {actionError && <p role="alert" className="text-red-800">{actionError}</p>}
    </div>
  </main>;
}
