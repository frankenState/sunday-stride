import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowDownUp, ArrowUp, Wifi, WifiOff } from 'lucide-react';
import { io } from 'socket.io-client';
import { elapsedFinishTime } from '../races/formatters';
import { getLeaderboardRows, type LeaderboardSortColumn, type LeaderboardSortDirection } from '../leaderboard/leaderboardModel';
import type { Race } from '../races/types';

type PublicFinish = { name: string; category: string; finishedAt: string };
type PublicBoard = { race: Race; categories: string[]; finishes: PublicFinish[] };

export function PublicLeaderboardPage() {
  const raceId = Number(window.location.pathname.match(/^\/live\/(\d+)/)?.[1]);
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<LeaderboardSortColumn>('finishTime');
  const [sortDirection, setSortDirection] = useState<LeaderboardSortDirection>('asc');

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${window.location.origin}/api/public/races/${raceId}/leaderboard`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Could not load the leaderboard.');
        if (!disposed) { setBoard(payload as PublicBoard); setError(''); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not load the leaderboard.');
      }
    };
    setBoard(null);
    setCategoryFilter(null);
    setSortColumn('finishTime');
    setSortDirection('asc');
    if (!Number.isSafeInteger(raceId) || raceId < 1) {
      setError('This leaderboard link is invalid.');
      return () => { disposed = true; };
    }
    void refresh();
    const socket = io(window.location.origin, { auth: { raceId } });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('leaderboard:changed', (message: { raceId?: number }) => {
      if (Number(message?.raceId) === raceId) void refresh();
    });
    return () => { disposed = true; socket.disconnect(); };
  }, [raceId]);

  const rows = useMemo(() => board ? getLeaderboardRows(board.finishes, categoryFilter, sortColumn, sortDirection) : [], [board, categoryFilter, sortColumn, sortDirection]);
  const toggleSort = (column: LeaderboardSortColumn) => {
    if (sortColumn === column) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(column); setSortDirection('asc'); }
  };
  const sortIcon = (column: LeaderboardSortColumn) => sortColumn !== column
    ? <ArrowDownUp size={13} aria-hidden="true" />
    : sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />;
  const sortHeader = (label: string, column: LeaderboardSortColumn) => <div className="sortable-column" role="columnheader" aria-sort={sortColumn === column ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" className="sortable-heading" aria-label={`Sort by ${label}`} onClick={() => toggleSort(column)}>{label}{sortIcon(column)}</button>
  </div>;

  return <main className="public-board">
    <header className="public-board-heading">
      <div><span className="public-board-eyebrow">LIVE RACE RESULTS</span><h1>{board?.race.name ?? 'Leaderboard'}</h1>{board && <p>{board.race.race_date}</p>}</div>
      <span className={`public-connection ${connected ? 'is-connected' : ''}`}><i />{connected ? <><Wifi size={14} /> Live</> : <><WifiOff size={14} /> Connecting</>}</span>
    </header>
    {error && <p className="public-board-error" role="alert">{error}</p>}
    {!board && !error && <div className="public-board-empty">Loading leaderboard…</div>}
    {board && <section className="panel leaderboard-panel public-board-panel">
      <div className="leaderboard-toolbar"><span>{rows.length} finishers</span></div>
      <div className="leaderboard-table public-board-table">
        <div className="leaderboard-head">
          {sortHeader('Place', 'place')}
          {sortHeader('Runner', 'runner')}
          <div className="category-column" role="columnheader" aria-sort={sortColumn === 'category' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" className="sortable-heading" aria-label="Sort by Category" onClick={() => toggleSort('category')}>Category{sortIcon('category')}</button>
            <select aria-label="Filter category" value={categoryFilter ?? ''} onChange={(event) => setCategoryFilter(event.target.value || null)}>
              <option value="">All</option>
              {board.categories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
          </div>
          {sortHeader('Finish Time', 'finishTime')}
        </div>
        {rows.length ? rows.map(({ runner, place }) => <div className="leaderboard-row" key={`${runner.name}:${runner.finishedAt}`}>
          <span className="place-number">{String(place).padStart(2, '0')}</span>
          <strong>{runner.name}</strong>
          <span className="public-category">{runner.category}</span>
          <time>{elapsedFinishTime(runner.finishedAt, board.race.start_at)}</time>
        </div>) : <div className="empty-state leaderboard-empty">{board.finishes.length ? 'No finishers in this category.' : 'No finishers recorded yet.'}</div>}
      </div>
    </section>}
    <footer className="public-board-footer"><Wifi size={14} /> Shared on the local network</footer>
  </main>;
}
