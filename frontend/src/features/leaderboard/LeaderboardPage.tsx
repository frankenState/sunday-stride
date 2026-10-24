import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowDownUp, ArrowUp, Expand, ExternalLink, Pencil, RotateCcw, Shrink, Trash2, Trophy } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { openProjectorWindow } from '../../desktopBridge';
import { elapsedFinishTime, localDateTimeInput } from '../races/formatters';
import { getLeaderboardRows, type LeaderboardSortColumn, type LeaderboardSortDirection } from './leaderboardModel';
import { useRace } from '../races/RaceContext';
import type { Runner } from '../races/types';

export function LeaderboardPage() {
  const { race, categories, finishes, busy, updateCategory, updateFinish, deleteFinish, resetRace } = useRace();
  const [editing, setEditing] = useState<Runner | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTime, setEditTime] = useState('');
  const [modalError, setModalError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Runner | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pageError, setPageError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<LeaderboardSortColumn>('finishTime');
  const [sortDirection, setSortDirection] = useState<LeaderboardSortDirection>('asc');
  const workspaceRef = useRef<HTMLElement>(null);
  const location = useLocation();
  useEffect(() => {
    setCategoryFilter(null);
    setSortColumn('finishTime');
    setSortDirection('asc');
  }, [race?.id]);
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  if (!race) return null;
  const filteredFinishes = categoryFilter === null
    ? finishes
    : finishes.filter((runner) => runner.category === categoryFilter);
  const sortedFinishes = getLeaderboardRows(finishes, categoryFilter, sortColumn, sortDirection);
  const projectorMode = new URLSearchParams(location.search).get('projector') === '1';
  const showProjector = () => void openProjectorWindow().catch((cause) => setPageError(cause instanceof Error ? cause.message : 'Could not open projector window.'));
  const toggleSort = (column: LeaderboardSortColumn) => {
    if (sortColumn === column) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(column); setSortDirection('asc'); }
  };
  const sortIcon = (column: LeaderboardSortColumn) => sortColumn !== column
    ? <ArrowDownUp size={12} aria-hidden="true" />
    : sortDirection === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />;
  const sortHeader = (label: string, column: LeaderboardSortColumn) => <div className="sortable-column" role="columnheader" aria-sort={sortColumn === column ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" className="sortable-heading" aria-label={`Sort by ${label}`} onClick={() => toggleSort(column)}>{label}{sortIcon(column)}</button>
  </div>;
  const toggleFullscreen = async () => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    try {
      if (document.fullscreenElement === workspace) await document.exitFullscreen();
      else await workspace.requestFullscreen();
    } catch (cause) { setPageError(cause instanceof Error ? cause.message : 'Could not enter fullscreen mode.'); }
  };
  const beginEdit = (runner: Runner) => { setEditing(runner); setEditName(runner.name); setEditCategory(runner.category); setEditTime(localDateTimeInput(runner.finishedAt)); setModalError(''); };
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    try {
      await updateFinish(editing, { name: editName.trim(), category: editCategory.trim(), finishedAt: new Date(editTime).toISOString() });
      setEditing(null);
    } catch (cause) { setModalError(cause instanceof Error ? cause.message : 'Could not save finish changes.'); }
  };
  const changeCategory = async (runner: Runner, selected: string) => {
    if (!selected || selected === runner.category) return;
    try { await updateCategory(runner, selected); }
    catch (cause) { setPageError(cause instanceof Error ? cause.message : 'Could not update category.'); }
  };
  const removeFinish = async () => {
    if (!pendingDelete) return;
    try { await deleteFinish(pendingDelete); setPendingDelete(null); }
    catch (cause) { setPageError(cause instanceof Error ? cause.message : 'Could not delete finish.'); }
  };
  const doReset = async () => {
    try { await resetRace(); setConfirmReset(false); }
    catch (cause) { setPageError(cause instanceof Error ? cause.message : 'Could not reset race.'); }
  };

  return <section ref={workspaceRef} className={`workspace leaderboard-workspace ${projectorMode ? 'projector-results' : ''}`}>
    <div className="section-heading"><div><h2>Leaderboard</h2><p>Finish order and official elapsed times.</p></div><div className="board-actions"><button className="button button-secondary" onClick={() => void toggleFullscreen()}>{fullscreen ? <Shrink size={15} /> : <Expand size={15} />}{fullscreen ? 'Exit full screen' : 'Full screen'}</button>{!projectorMode && <><button className="button button-secondary" onClick={showProjector}><ExternalLink size={15} /> Open projector</button><button className="button button-secondary" onClick={() => setConfirmReset(true)} disabled={!finishes.length || busy}><RotateCcw size={15} /> Reset results</button></>}</div></div>
    {pageError && <p className="inline-error" role="alert">{pageError}</p>}
    <section className="panel leaderboard-panel">
      <div className="leaderboard-toolbar"><span>{filteredFinishes.length} finishers</span></div>
      <div className="leaderboard-table">
        <div className="leaderboard-head">
          {sortHeader('Place', 'place')}
          {sortHeader('Runner', 'runner')}
          <div className="category-column" role="columnheader" aria-sort={sortColumn === 'category' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" className="sortable-heading" aria-label="Sort by Category" onClick={() => toggleSort('category')}>Category{sortIcon('category')}</button>
            <select aria-label="Filter category" value={categoryFilter ?? ''} onChange={(event) => setCategoryFilter(event.target.value || null)}>
              <option value="">All</option>
              {categories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
          </div>
          {sortHeader('Finish Time', 'finishTime')}
          <span className="actions-column">ACTIONS</span>
        </div>
        {sortedFinishes.length ? sortedFinishes.map(({ runner, place }) => <div className="leaderboard-row" key={runner.idKey}>
          <span className="place-number">{String(place).padStart(2, '0')}</span>
          <strong>{runner.name}</strong>
          {fullscreen ? <span className="leaderboard-category-display">{runner.category}</span> : <select value={runner.category} onChange={(event) => void changeCategory(runner, event.target.value)} aria-label={`Change ${runner.name} category`}>
            {Array.from(new Set([runner.category, ...categories])).map((category) => <option value={category} key={category}>{category}</option>)}
          </select>}
          <time>{elapsedFinishTime(runner.finishedAt, race.start_at)}</time>
          {!fullscreen && <div className="row-actions">
            <button className="icon-button" onClick={() => beginEdit(runner)} aria-label={`Edit ${runner.name}`}><Pencil size={15} /></button>
            <button className="icon-button delete-action" onClick={() => setPendingDelete(runner)} aria-label={`Delete ${runner.name}`}><Trash2 size={15} /></button>
          </div>}
        </div>) : <div className="empty-state leaderboard-empty">
          <Trophy size={22} />
          <strong>{finishes.length ? 'No finishers in this category.' : 'No finishers recorded yet.'}</strong>
        </div>}
      </div>
    </section>

    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-runner-title"><div className="dialog-heading"><div><span className="step-label">FINISH CORRECTION</span><h2 id="edit-runner-title">Edit runner</h2></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="Close">×</button></div><form onSubmit={(event) => void saveEdit(event)}><label>Name<input value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={120} /></label><label>Category<select value={editCategory} onChange={(event) => setEditCategory(event.target.value)} required>{Array.from(new Set([editCategory, ...categories])).map((category) => <option value={category} key={category}>{category}</option>)}</select></label><label>Finish time<input type="datetime-local" step="1" value={editTime} onChange={(event) => setEditTime(event.target.value)} required /></label>{modalError && <p className="inline-error" role="alert">{modalError}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Save changes</button></div></form></section></div>}
    {pendingDelete && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-finish-title"><div className="dialog-heading"><div><span className="step-label">DELETE FINISH</span><h2 id="delete-finish-title">Remove {pendingDelete.name}?</h2><p>The runner will remain on the roster.</p></div></div><div className="dialog-actions"><button className="button button-secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button className="button button-danger" onClick={() => void removeFinish()} disabled={busy}>Delete finish</button></div></section></div>}
    {confirmReset && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="reset-race-title"><div className="dialog-heading"><div><span className="step-label">RESET RESULTS</span><h2 id="reset-race-title">Reset {race.name}?</h2><p>This clears all finishes and resets its clock. The roster stays.</p></div></div><div className="dialog-actions"><button className="button button-secondary" onClick={() => setConfirmReset(false)}>Cancel</button><button className="button button-danger" onClick={() => void doReset()} disabled={busy}>Reset race</button></div></section></div>}
  </section>;
}
