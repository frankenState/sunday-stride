import { useState, type ReactNode, type FormEvent } from 'react';
import { Activity, CalendarDays, Check, CheckCheck, ChevronLeft, ClipboardCopy, Clock3, ExternalLink, Flag, ListChecks, Menu, Plus, QrCode as QrCodeIcon, Timer, Trophy, Users, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getPublicLeaderboardBaseUrl, isDesktopApp, openProjectorWindow } from '../desktopBridge';
import { useRace } from '../features/races/RaceContext';
import { fmtClock } from '../features/races/formatters';
import { QrCode } from '../shared/QrCode';

export function RaceDashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820);
  const location = useLocation();
  const navigate = useNavigate();
  const { races, selectedId, selectRace, connected, error, setError, createModalOpen, openCreateRace, closeCreateRace } = useRace();
  const projectorMode = new URLSearchParams(location.search).get('projector') === '1';
  const racePage = location.pathname.match(/^\/races\/(\d+)/);
  const activeId = racePage ? Number(racePage[1]) : selectedId;

  return <main className={`dashboard ${sidebarOpen ? '' : 'sidebar-collapsed'} ${projectorMode ? 'projector-layout' : ''}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="app-mark"><Flag size={16} /></span>{sidebarOpen && <span>Race Desk</span>}<button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>{sidebarOpen ? <ChevronLeft size={17} /> : <Menu size={17} />}</button></div>
      <div className="sidebar-section-heading">{sidebarOpen && <span>RACES</span>}<button className="icon-button add-race" onClick={openCreateRace} title="Create race" aria-label="Create race"><Plus size={17} /></button></div>
      <div className="race-list">{races.map((item) => <button key={item.id} className={`race-list-item ${activeId === item.id ? 'selected' : ''}`} onClick={() => { selectRace(item.id); navigate(`/races/${item.id}/registration`); }} title={item.name}><span className={`race-status-mark status-${item.status}`} />{sidebarOpen && <span className="race-list-copy"><strong>{item.name}</strong><small>{item.race_date} · {item.status}</small></span>}</button>)}</div>
      {sidebarOpen && <div className="sidebar-bottom"><span className={`connection-indicator ${connected ? 'connected' : ''}`} />{connected ? 'Service connected' : 'Connecting to service'}</div>}
    </aside>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close race navigation" />}

    <section className="main-panel">
      <button className="mobile-menu icon-button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Toggle sidebar"><Menu size={18} /></button>
      {error && <div className="alert alert-error" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
      {children}
    </section>

    {createModalOpen && <CreateRaceDialog onClose={closeCreateRace} />}
  </main>;
}

export function RaceControls() {
  const { race, roster, now, busy, startRace, completeRace } = useRace();
  const [projectorError, setProjectorError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBaseUrl, setShareBaseUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState('');
  const [copied, setCopied] = useState(false);
  if (!race) return null;
  const stopAt = race.status === 'completed' && race.completed_at ? Date.parse(race.completed_at) : now;
  const clock = race.start_at ? fmtClock(stopAt - Date.parse(race.start_at)) : '00:00:00';
  const launchProjector = () => void openProjectorWindow().catch((cause) => setProjectorError(cause instanceof Error ? cause.message : 'Could not open projector window.'));
  const openShare = async () => {
    setShareOpen(true);
    setShareBaseUrl(null);
    setShareError('');
    setCopied(false);
    try {
      const baseUrl = await getPublicLeaderboardBaseUrl();
      if (!baseUrl) setShareError('Leaderboard sharing is unavailable. Check that this computer is connected to a private Wi-Fi or hotspot network.');
      else setShareBaseUrl(baseUrl);
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : 'Could not get the local network address.');
    }
  };
  const shareUrl = shareBaseUrl && `${shareBaseUrl}/live/${race.id}`;
  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareUrl);
      else {
        const input = document.querySelector<HTMLInputElement>('.share-link-input');
        input?.select();
        if (!document.execCommand('copy')) throw new Error('Select and copy the link from the field.');
      }
      setCopied(true);
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : 'Could not copy the leaderboard link.');
    }
  };
  return <>
    <div className="header-actions">
      <div className="clock-box"><span className={`clock-indicator ${race.status === 'running' ? 'active' : ''}`} /><Timer size={15} /><strong>{clock}</strong></div>
      {race.status === 'setup' && <button className="button button-secondary" disabled><Clock3 size={15} /> Import roster to start</button>}
      {race.status === 'ready' && <button className="button button-primary" onClick={() => void startRace().catch(() => undefined)} disabled={busy || roster.length === 0}><Clock3 size={15} /> Start race clock</button>}
      {race.status === 'running' && <button className="button button-danger" onClick={() => { if (window.confirm('Complete this race? The clock will stop and check-ins will be locked.')) void completeRace().catch(() => undefined); }} disabled={busy}><Check size={15} /> Complete race</button>}
      {(isDesktopApp || import.meta.env.DEV) && <button className="button button-secondary" onClick={() => void openShare()}><QrCodeIcon size={15} /> Share leaderboard</button>}
      <button className="button button-secondary projector-button" onClick={launchProjector}><ExternalLink size={15} /> Projector</button>
      {projectorError && <span role="alert" className="inline-error">{projectorError}</span>}
    </div>
    {shareOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareOpen(false); }}>
      <section className="dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-leaderboard-title">
        <div className="dialog-heading"><div><span className="step-label">LOCAL NETWORK</span><h2 id="share-leaderboard-title">Share leaderboard</h2><p>Viewers on the same Wi-Fi or hotspot can scan this code.</p></div><button className="icon-button" onClick={() => setShareOpen(false)} aria-label="Close"><X size={18} /></button></div>
        {shareUrl ? <div className="share-content"><div className="share-qr"><QrCode value={shareUrl} /></div><label className="share-link-label">Leaderboard link<input className="share-link-input" value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label><button className="button button-primary" onClick={() => void copyShareUrl()}>{copied ? <CheckCheck size={15} /> : <ClipboardCopy size={15} />}{copied ? 'Copied' : 'Copy link'}</button><p className="share-help">If viewers cannot connect, allow Sunday Stride through Windows Firewall on a private network and check that your hotspot or router permits device-to-device connections.</p></div> : <p className={shareError ? 'inline-error share-error' : 'share-loading'} role={shareError ? 'alert' : 'status'}>{shareError || 'Finding this computer on the local network…'}</p>}
      </section>
    </div>}
  </>;
}

export function RaceSummary() {
  const { race, roster, finishes } = useRace();
  if (!race) return null;
  return <>
    <div className="race-summary"><span><CalendarDays size={14} /> {race.race_date}</span><span><Users size={14} /> {roster.length} registered</span><span><Trophy size={14} /> {finishes.length} finished</span><span className={`status-pill pill-${race.status}`}>{race.status}</span></div>
    <nav className="workflow-tabs" aria-label="Race workflow">
      <Link className={location.pathname.endsWith('/registration') ? 'active' : ''} to={`/races/${race.id}/registration`}><ListChecks size={16} /> Registration</Link>
      <Link className={location.pathname.endsWith('/recording') ? 'active' : ''} to={`/races/${race.id}/recording`}><Activity size={16} /> Recording</Link>
      <Link className={location.pathname.endsWith('/leaderboard') ? 'active' : ''} to={`/races/${race.id}/leaderboard`}><Trophy size={16} /> Leaderboard<span className="tab-count">{finishes.length}</span></Link>
    </nav>
  </>;
}

function CreateRaceDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [raceDate, setRaceDate] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();
  const { createRace, busy } = useRace();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    try {
      const race = await createRace(name, raceDate);
      onClose();
      navigate(`/races/${race.id}/registration`);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Race could not be created.'); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-race-title"><div className="dialog-heading"><div><span className="step-label">NEW RACE</span><h2 id="create-race-title">Create a race</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><form onSubmit={(event) => void submit(event)}><label>Race name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Community fun run" maxLength={120} required autoFocus /></label><label>Race date<input type="date" value={raceDate} onChange={(event) => setRaceDate(event.target.value)} required /></label>{formError && <p className="inline-error">{formError}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create race'}</button></div></form></section></div>;
}
