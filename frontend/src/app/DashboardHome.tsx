import { Flag, Plus } from 'lucide-react';
import { useRace } from '../features/races/RaceContext';

export function DashboardHome() {
  const { openCreateRace, loaded } = useRace();
  if (!loaded) return <div className="route-loading">Loading races…</div>;
  return <section className="welcome-panel"><span className="welcome-icon"><Flag size={22} /></span><h2>Create a race to get started</h2><p>Each race has its own registration list, finish clock, and results.</p><button className="button button-primary" onClick={openCreateRace}><Plus size={16} /> Create a race</button></section>;
}
