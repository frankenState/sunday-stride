import { useEffect, useRef, useState } from 'react';
import { Activity, Check, ChevronRight, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../desktopBridge';
import { elapsedFinishTime } from '../races/formatters';
import { useRace } from '../races/RaceContext';
import type { Runner } from '../races/types';

export function RecordingPage() {
  const { race, finishes, recordRunner, busy } = useRace();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Runner[]>([]);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const raceId = race?.id;
  const raceStatus = race?.status;

  useEffect(() => {
    if (!raceId || !query.trim() || raceStatus !== 'running') { setSuggestions([]); return; }
    const timer = window.setTimeout(() => {
      void apiRequest<Runner[]>(`/api/races/${raceId}/roster/search?q=${encodeURIComponent(query.trim())}`).then(setSuggestions).catch(() => setSuggestions([]));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query, raceId, raceStatus]);

  if (!race) return null;
  const record = async (runner: Runner) => {
    if (runner.finished || busy) return;
    try { await recordRunner(runner); }
    catch { return; }
    setNotice(`${runner.name} recorded`);
    setQuery('');
    setSuggestions([]);
    inputRef.current?.focus();
    window.setTimeout(() => setNotice(''), 2500);
  };
  const latest = finishes[finishes.length - 1];

  return <section className="workspace recording-workspace">
    <div className="section-heading"><div><h2>Finish recording</h2><p>Search the roster and record each runner as they cross the line.</p></div><span className={`status-pill pill-${race.status}`}>{race.status}</span></div>
    <div className="recording-grid"><section className="panel checkin-panel"><div className="panel-heading"><div><h3>Find a runner</h3><p>Search by runner name or race ID; select a match or press Enter.</p></div><span className="step-label">{race.status === 'running' ? 'CLOCK RUNNING' : 'CHECK-IN LOCKED'}</span></div>
      <div className="search-field"><Search size={17} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && suggestions[0] && !suggestions[0].finished) { event.preventDefault(); void record(suggestions[0]); } if (event.key === 'Escape') setSuggestions([]); }} placeholder={race.status === 'running' ? 'Type a runner name or race ID…' : 'Start the race clock to enable check-in'} disabled={race.status !== 'running'} autoComplete="off" /></div>
      {suggestions.length > 0 && <div className="suggestions" role="listbox" aria-label="Runner recommendations">{suggestions.map((runner, index) => <button key={runner.idKey} className="suggestion" disabled={runner.finished || busy} onClick={() => void record(runner)} role="option" aria-selected={index === 0}><span><strong>{runner.name}</strong><small>ID {runner.idKey} · {runner.category}</small></span><span>{runner.finished ? 'Finished' : index === 0 ? 'Enter ↵' : 'Select'}</span></button>)}</div>}
      {notice && <p className="success-message" role="status"><Check size={16} /> {notice}</p>}
      <div className="checkin-help"><span>Registered runners only</span><span>One finish per runner</span></div>
    </section>
    <section className="panel recent-panel"><div className="panel-heading"><div><h3>Latest finish</h3><p>Most recently recorded runner.</p></div><Activity size={18} /></div>{latest ? <div className="latest-runner"><span className="runner-initial">{latest.name[0]?.toUpperCase()}</span><div><strong>{latest.name}</strong><small>{latest.category}</small></div><time>{elapsedFinishTime(latest.finishedAt, race.start_at)}</time></div> : <div className="empty-state"><span>Waiting for the first finish.</span></div>}<Link className="text-button" to={`/races/${race.id}/leaderboard`}>View full leaderboard <ChevronRight size={15} /></Link></section></div>
    <section className="panel recent-list-panel"><div className="panel-heading"><div><h3>Recent finishers</h3><p>Latest 8 recorded runners.</p></div><span className="step-label">{finishes.length} TOTAL</span></div>{finishes.length ? <div className="recent-finish-list">{[...finishes].slice(-8).reverse().map((runner) => <div key={runner.idKey}><span>{runner.name}</span><span>{runner.category}</span><time>{elapsedFinishTime(runner.finishedAt, race.start_at)}</time></div>)}</div> : <div className="empty-state">No finishes recorded yet.</div>}</section>
  </section>;
}
