import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { apiRequest, createRaceSocket, initializeDesktopBridge } from '../../desktopBridge';
import type { Race, Runner } from './types';

type RaceContextValue = {
  races: Race[];
  race: Race | null;
  selectedId: number | null;
  roster: Runner[];
  categories: string[];
  finishes: Runner[];
  connected: boolean;
  loaded: boolean;
  loadedRaceId: number | null;
  now: number;
  busy: boolean;
  createModalOpen: boolean;
  openCreateRace: () => void;
  closeCreateRace: () => void;
  error: string;
  setError: (value: string) => void;
  selectRace: (id: number) => void;
  refreshRaces: () => Promise<void>;
  refreshSelected: (id: number) => Promise<void>;
  createRace: (name: string, raceDate: string) => Promise<Race>;
  startRace: () => Promise<void>;
  completeRace: () => Promise<void>;
  resetRace: () => Promise<void>;
  recordRunner: (runner: Runner) => Promise<void>;
  updateCategory: (runner: Runner, category: string) => Promise<void>;
  updateRosterRunner: (runner: Runner, changes: { name: string; category: string }) => Promise<void>;
  deleteRosterRunner: (runner: Runner) => Promise<void>;
  addCategory: (category: string) => Promise<void>;
  updateFinish: (runner: Runner, patch: { name: string; category: string; finishedAt: string }) => Promise<void>;
  deleteFinish: (runner: Runner) => Promise<void>;
};

const RaceContext = createContext<RaceContextValue | null>(null);

export function RaceProvider({ children }: { children: ReactNode }) {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(localStorage.getItem('selectedRaceId')) || null);
  const [roster, setRoster] = useState<Runner[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [finishes, setFinishes] = useState<Runner[]>([]);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedRaceId, setLoadedRaceId] = useState<number | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;
  const race = races.find((item) => item.id === selectedId) ?? null;

  const refreshRaces = useCallback(async () => {
    const list = await apiRequest<Race[]>('/api/races');
    setRaces(list);
    setSelectedId((current) => {
      const chosen = current && list.some((item) => item.id === current)
        ? current
        : (list.find((item) => item.status === 'running') ?? list[0])?.id ?? null;
      if (chosen) localStorage.setItem('selectedRaceId', String(chosen));
      else localStorage.removeItem('selectedRaceId');
      return chosen;
    });
  }, []);

  const refreshSelected = useCallback(async (id: number) => {
    const [people, board, raceCategories] = await Promise.all([
      apiRequest<Runner[]>(`/api/races/${id}/roster`),
      apiRequest<Runner[]>(`/api/races/${id}/finishes`),
      apiRequest<string[]>(`/api/races/${id}/categories`),
    ]);
    if (selectedIdRef.current === id) {
      setRoster(people);
      setFinishes(board);
      setCategories(raceCategories);
      setLoadedRaceId(id);
    }
  }, []);

  const selectRace = useCallback((id: number) => {
    setSelectedId(id);
    localStorage.setItem('selectedRaceId', String(id));
    setError('');
  }, []);
  const openCreateRace = useCallback(() => setCreateModalOpen(true), []);
  const closeCreateRace = useCallback(() => setCreateModalOpen(false), []);

  useEffect(() => {
    let disposed = false;
    let client: Socket | null = null;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    void initializeDesktopBridge().then(async () => {
      if (disposed) return;
      await refreshRaces();
      if (disposed) return;
      client = createRaceSocket();
      socketRef.current = client;
      setSocket(client);
      client.on('connect', onConnect);
      client.on('disconnect', onDisconnect);
      client.connect();
      setLoaded(true);
    }).catch((cause) => {
      setLoaded(true);
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not connect to the race service.');
    });
    const ticker = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      disposed = true;
      window.clearInterval(ticker);
      client?.off('connect', onConnect);
      client?.off('disconnect', onDisconnect);
      client?.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [refreshRaces]);

  useEffect(() => {
    setLoadedRaceId(null);
    if (!selectedId) { setRoster([]); setFinishes([]); setCategories([]); return; }
    let disposed = false;
    void refreshSelected(selectedId).catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not load race data.');
    });
    return () => { disposed = true; };
  }, [selectedId, refreshSelected]);

  useEffect(() => {
    const client = socket;
    if (!selectedId || !client) return;
    const changedEvents = ['runner:finished', 'runner:updated', 'runner:deleted', 'roster:updated', 'roster:deleted', 'roster:imported', 'categories:updated', 'race:started', 'race:completed', 'race:reset'];
    const changed = (data: unknown) => {
      const payload = data as { raceId?: number } | undefined;
      const activeId = selectedIdRef.current;
      if (!activeId || Number(payload?.raceId) !== activeId) return;
      void refreshSelected(activeId).catch(() => undefined);
      void refreshRaces().catch(() => undefined);
    };
    const created = () => { void refreshRaces().catch(() => undefined); };
    changedEvents.forEach((event) => client.on(event, changed));
    client.on('race:created', created);
    return () => {
      changedEvents.forEach((event) => client.off(event, changed));
      client.off('race:created', created);
    };
  }, [socket, refreshRaces, refreshSelected]);

  const withBusy = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); throw cause; }
    finally { setBusy(false); }
  }, []);

  const createRace = useCallback(async (name: string, raceDate: string) => {
    setBusy(true);
    setError('');
    try {
      const created = await apiRequest<Race>('/api/races', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), raceDate }) });
      await refreshRaces();
      selectRace(created.id);
      return created;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Race could not be created.');
      throw cause;
    } finally { setBusy(false); }
  }, [refreshRaces, selectRace]);

  const startRace = useCallback(async () => {
    if (!race) return;
    await withBusy(async () => { await apiRequest(`/api/races/${race.id}/start`, { method: 'POST' }); await refreshRaces(); }, 'Could not start the race clock.');
  }, [race, refreshRaces, withBusy]);

  const completeRace = useCallback(async () => {
    if (!race) return;
    await withBusy(async () => { await apiRequest(`/api/races/${race.id}/complete`, { method: 'POST' }); await refreshRaces(); }, 'Could not complete the race.');
  }, [race, refreshRaces, withBusy]);

  const resetRace = useCallback(async () => {
    if (!race) return;
    await withBusy(async () => { await apiRequest(`/api/races/${race.id}/finishes`, { method: 'DELETE' }); await refreshSelected(race.id); await refreshRaces(); }, 'Could not reset the race.');
  }, [race, refreshRaces, refreshSelected, withBusy]);

  const recordRunner = useCallback(async (runner: Runner) => {
    if (!race || runner.finished || race.status !== 'running') return;
    await withBusy(async () => {
      await apiRequest(`/api/races/${race.id}/finishes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idKey: runner.idKey }) });
      await refreshSelected(race.id);
    }, 'Could not record runner.');
  }, [race, refreshSelected, withBusy]);

  const updateCategory = useCallback(async (runner: Runner, category: string) => {
    if (!race || !category || category === runner.category) return;
    await withBusy(async () => {
      await apiRequest(`/api/races/${race.id}/roster/${encodeURIComponent(runner.idKey)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }) });
      await refreshSelected(race.id);
    }, 'Could not update category.');
  }, [race, refreshSelected, withBusy]);

  const updateRosterRunner = useCallback(async (runner: Runner, changes: { name: string; category: string }) => {
    if (!race) return;
    await withBusy(async () => {
      await apiRequest(`/api/races/${race.id}/roster/${encodeURIComponent(runner.idKey)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      await refreshSelected(race.id);
    }, 'Could not update runner.');
  }, [race, refreshSelected, withBusy]);

  const deleteRosterRunner = useCallback(async (runner: Runner) => {
    if (!race) return;
    await withBusy(async () => {
      await apiRequest(`/api/races/${race.id}/roster/${encodeURIComponent(runner.idKey)}`, { method: 'DELETE' });
      await refreshSelected(race.id);
      await refreshRaces();
    }, 'Could not delete runner.');
  }, [race, refreshRaces, refreshSelected, withBusy]);

  const addCategory = useCallback(async (category: string) => {
    if (!race) return;
    await withBusy(async () => {
      await apiRequest<string[]>(`/api/races/${race.id}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }) });
      await refreshSelected(race.id);
    }, 'Could not add category.');
  }, [race, refreshSelected, withBusy]);

  const updateFinish = useCallback(async (runner: Runner, patch: { name: string; category: string; finishedAt: string }) => {
    if (!race) return;
    await withBusy(async () => {
      await apiRequest(`/api/races/${race.id}/finishes/${encodeURIComponent(runner.idKey)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      await refreshSelected(race.id);
    }, 'Could not save finish changes.');
  }, [race, refreshSelected, withBusy]);

  const deleteFinish = useCallback(async (runner: Runner) => {
    if (!race) return;
    await withBusy(async () => {
      await apiRequest(`/api/races/${race.id}/finishes/${encodeURIComponent(runner.idKey)}`, { method: 'DELETE' });
      await refreshSelected(race.id);
    }, 'Could not delete finish.');
  }, [race, refreshSelected, withBusy]);

  const value = useMemo<RaceContextValue>(() => ({
    races, race, selectedId, roster, categories, finishes, connected, loaded, loadedRaceId, now, busy, createModalOpen,
    openCreateRace, closeCreateRace, error, setError,
    selectRace, refreshRaces, refreshSelected, createRace, startRace, completeRace, resetRace,
    recordRunner, updateCategory, updateRosterRunner, deleteRosterRunner, addCategory, updateFinish, deleteFinish,
  }), [races, race, selectedId, roster, categories, finishes, connected, loaded, loadedRaceId, now, busy, createModalOpen, openCreateRace, closeCreateRace, error, selectRace, refreshRaces, refreshSelected, createRace, startRace, completeRace, resetRace, recordRunner, updateCategory, updateRosterRunner, deleteRosterRunner, addCategory, updateFinish, deleteFinish]);

  return <RaceContext.Provider value={value}>{children}</RaceContext.Provider>;
}

export function useRace() {
  const context = useContext(RaceContext);
  if (!context) throw new Error('useRace must be used inside RaceProvider.');
  return context;
}
