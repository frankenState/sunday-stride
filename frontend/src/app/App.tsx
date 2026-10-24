import { useEffect } from 'react';
import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { RaceDashboardLayout } from './RaceDashboardLayout';
import { RaceControls, RaceSummary } from './RaceDashboardLayout';
import { RaceProvider, useRace } from '../features/races/RaceContext';
import { RegistrationPage } from '../features/registration/RegistrationPage';
import { RecordingPage } from '../features/recording/RecordingPage';
import { LeaderboardPage } from '../features/leaderboard/LeaderboardPage';
import { isDesktopApp } from '../desktopBridge';
import { DashboardHome } from './DashboardHome';
import { PublicLeaderboardPage } from '../features/publicLeaderboard/PublicLeaderboardPage';

function RaceWorkspaceLayout() {
  const { raceId } = useParams();
  const { races, race, selectedId, selectRace, loaded, loadedRaceId } = useRace();
  const match = races.find((item) => item.id === Number(raceId));
  useEffect(() => {
    if (match && selectedId !== match.id) selectRace(match.id);
  }, [match, selectedId, selectRace]);

  if (!loaded) return <div className="route-loading">Loading races…</div>;
  if (!match) return <Navigate to="/" replace />;
  if (selectedId !== match.id || loadedRaceId !== match.id || !race) return <div className="route-loading">Loading {match.name}…</div>;

  return <>
    <header className="main-header">
      <div className="header-context"><div><div className="breadcrumb">RACES <span>›</span> {race.name}</div><h1>{race.name}</h1></div></div>
      <RaceControls />
    </header>
    <RaceSummary />
    <Outlet />
  </>;
}

function RaceIndexRedirect() {
  const { raceId } = useParams();
  return <Navigate to={`/races/${raceId}/registration`} replace />;
}

function RootRedirect() {
  const { races, selectedId, loaded } = useRace();
  if (!loaded) return <div className="route-loading">Loading races…</div>;
  const chosen = races.find((item) => item.id === selectedId) ?? races.find((item) => item.status === 'running') ?? races[0];
  if (chosen) return <Navigate to={`/races/${chosen.id}/registration`} replace />;
  return <DashboardHome />;
}

function LegacyRedirect() {
  const { selectedId, loaded } = useRace();
  const { pathname, search } = useLocation();
  if (!loaded) return <div className="route-loading">Loading races…</div>;
  if (!selectedId) return <Navigate to="/" replace />;
  const page = pathname === '/runner-input' ? 'recording' : pathname === '/leaderboard' ? 'leaderboard' : 'registration';
  return <Navigate to={`/races/${selectedId}/${page}${search}`} replace />;
}

function NotFoundRedirect() {
  return <Navigate to="/" replace />;
}

function AppRoutes() {
  const location = useLocation();
  if (location.pathname.startsWith('/live/')) return <PublicLeaderboardPage />;
  return <RaceProvider><RaceDashboardLayout><Routes>
    <Route index element={<RootRedirect />} />
    <Route path="races/:raceId" element={<RaceWorkspaceLayout />}>
      <Route index element={<RaceIndexRedirect />} />
      <Route path="registration" element={<RegistrationPage />} />
      <Route path="recording" element={<RecordingPage />} />
      <Route path="leaderboard" element={<LeaderboardPage />} />
    </Route>
    <Route path="registration" element={<LegacyRedirect />} />
    <Route path="runner-input" element={<LegacyRedirect />} />
    <Route path="leaderboard" element={<LegacyRedirect />} />
    <Route path="*" element={<NotFoundRedirect />} />
  </Routes></RaceDashboardLayout></RaceProvider>;
}

export default function App() {
  const Router = isDesktopApp ? HashRouter : BrowserRouter;
  return <Router><AppRoutes /></Router>;
}
