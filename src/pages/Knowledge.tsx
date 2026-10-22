import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { CIVIC_MODES } from '../../supabase/functions/_shared/civic';
import { CIVIC_SOURCES } from '../../supabase/functions/_shared/civic-sources';
import { PASSAGE_COUNT } from '../../supabase/functions/_shared/civic-coverage';

export default function Knowledge() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const sources = CIVIC_SOURCES.filter(s => (category === 'all' || s.category === category) && `${s.title} ${s.jurisdiction}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="min-h-screen bg-white text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-4 p-6"><div><h1 className="text-2xl tracking-wide font-semibold">Civic knowledge library</h1><p className="text-sm text-slate-600 mt-1">Primary sources. Practical wisdom. Better questions.</p></div><TopNav /></header>
    <section className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="civic-gradient border rounded-2xl p-6"><p className="text-sm font-semibold text-blue-900">RESEARCH COVERAGE</p><h2 className="text-2xl mt-2">A foundation for informed public service</h2><p className="text-slate-700 mt-3 max-w-3xl">{PASSAGE_COUNT} searchable passages from selected constitutional, statutory, historical, and philosophical snapshots are connected to the advisor. Other entries below are source directories, not downloaded collections. Federal and state civil and criminal law, regulations, and case law require reviewed imports and updates. This is not a complete legal database.</p></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{CIVIC_MODES.map(m => <Link key={m.id} to={`/?mode=${m.id}`} className="border rounded-xl p-4 hover:border-blue-500 hover:bg-blue-50 transition"><h3 className="font-semibold">{m.label}</h3><p className="text-sm text-slate-600 mt-2">{m.description}</p><span className="text-xs text-blue-800 block mt-3">Explore with the advisor →</span></Link>)}</div>
      <div className="flex flex-wrap gap-3"><input aria-label="Search sources" className="border rounded-lg p-3 flex-1 min-w-48" placeholder="Search primary-source collections…" value={query} onChange={e=>setQuery(e.target.value)} /><select aria-label="Filter source category" className="border rounded-lg p-3" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All subjects</option>{CIVIC_MODES.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
      <div className="grid md:grid-cols-2 gap-4">{sources.map(s => <article className="border rounded-xl p-5" key={s.id}><p className="text-xs uppercase tracking-wide text-blue-800">{s.jurisdiction}</p><h3 className="font-semibold text-lg mt-1">{s.title}</h3><p className="text-sm text-slate-600 mt-2">{s.coverage === 'snapshot' ? 'Selected text snapshot available to the advisor.' : 'Source directory — full collection not imported.'}</p><a className="inline-block mt-3 text-blue-800 underline underline-offset-4" href={s.url} target="_blank" rel="noreferrer">Open source ↗</a></article>)}</div>
      {sources.length === 0 && <p>No matching sources. Try another subject or search.</p>}
      <p className="text-sm text-slate-600">For state-law questions, specify the state and date, consult its legislature and judiciary, and check relevant local rules. Philosophical works inform reflection; they are not legal authority.</p>
    </section>
  </main>;
}
