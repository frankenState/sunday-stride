import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock, publicSocket, getPublicLeaderboardBaseUrlMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  publicSocket: { on: vi.fn(), disconnect: vi.fn() },
  getPublicLeaderboardBaseUrlMock: vi.fn(),
}));
vi.mock('../desktopBridge', () => ({
  apiRequest: apiRequestMock,
  createRaceSocket: () => ({ on: vi.fn(), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
  getPublicLeaderboardBaseUrl: getPublicLeaderboardBaseUrlMock,
  initializeDesktopBridge: async () => undefined,
  isDesktopApp: false,
  openProjectorWindow: async () => undefined,
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => publicSocket) }));

import App from './App';
import { QrCode } from '../shared/QrCode';
import type { Race, Runner } from '../features/races/types';

const makeRace = (status: Race['status'] = 'ready'): Race => ({
  id: 7, name: 'Community Run', race_date: '2026-10-24', status,
  start_at: status === 'running' ? '2026-10-24T00:00:00.000Z' : null,
  completed_at: null,
});
const runners: Runner[] = [{ id: 1, idKey: 'runner-1', name: 'Alex Runner', category: 'Women-5k', finishedAt: '2026-10-24T00:01:00.000Z', finished: false }];
let races: Race[];
let finishes: Runner[];
let categories: string[];

function setRoute(path: string) {
  window.history.replaceState({}, '', path);
}

function setupApi(status: Race['status'] = 'ready') {
  races = [makeRace(status)];
  finishes = [];
  categories = ['Women-5k'];
  Object.assign(runners[0], { name: 'Alex Runner', category: 'Women-5k', finishedAt: '2026-10-24T00:01:00.000Z' });
  apiRequestMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/races') return races;
    if (path === '/api/races/8/roster') return [];
    if (path === '/api/races/8/finishes') return [];
    if (path === '/api/races/8/categories') return [];
    if (path === '/api/races/7/categories') {
      if (init?.method === 'POST') {
        const { category } = JSON.parse(String(init.body)) as { category: string };
        if (!categories.some((item) => item.toLowerCase() === category.toLowerCase())) categories.push(category);
      }
      return [...categories];
    }
    if (path === '/api/races/7/roster') return runners.map((runner) => ({ ...runner, finished: finishes.some((item) => item.idKey === runner.idKey) }));
    if (path === '/api/races/7/finishes' && init?.method === 'DELETE') { finishes = []; races = [makeRace('ready')]; return { ok: true }; }
    if (path === '/api/races/7/finishes' && init?.method === 'POST') {
      const { idKey } = JSON.parse(String(init.body)) as { idKey: string };
      const runner = runners.find((item) => item.idKey === idKey)!;
      finishes = [{ ...runner, finished: true }];
      return finishes[0];
    }
    if (path === '/api/races/7/finishes') return finishes;
    if (path === '/api/races/7/roster/runner-1' && init?.method === 'PATCH') {
      Object.assign(runners[0], JSON.parse(String(init.body)));
      return runners[0];
    }
    if (path.startsWith('/api/races/7/roster/search')) {
      const query = new URL(path, 'http://localhost').searchParams.get('q')?.toLowerCase() ?? '';
      return runners.filter((runner) => runner.name.toLowerCase().includes(query) || runner.idKey.toLowerCase().includes(query)).map((runner) => ({ ...runner, finished: finishes.some((item) => item.idKey === runner.idKey) }));
    }
    if (path.endsWith('/roster/import')) {
      const committed = JSON.parse(String(init?.body)).commit === true;
      return { records: [{ idKey: 'runner-2', name: 'New Runner', category: 'Men-3k' }], errors: [], additions: 1, updates: 0, applied: committed };
    }
    return {};
  });
}

describe('race routes and workflows', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    getPublicLeaderboardBaseUrlMock.mockReset().mockResolvedValue('http://192.168.1.20:41000');
    window.localStorage.setItem('selectedRaceId', '7');
    setupApi();
  });

  it('redirects the legacy recording path to the selected race route', async () => {
    setRoute('/runner-input');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Finish recording' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/races/7/recording');
  });

  it('switches race context when a different race is selected in the sidebar', async () => {
    races = [makeRace(), { ...makeRace(), id: 8, name: 'School Run' }];
    setRoute('/races/7/registration');
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /School Run/ }));
    expect(await screen.findByRole('heading', { name: 'School Run' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/races/8/registration');
  });

  it('previews and applies a registration roster import', async () => {
    setRoute('/races/7/registration');
    render(<App />);
    const user = userEvent.setup();
    const csv = await screen.findByPlaceholderText(/id_key_1, Mark Collins/);
    await user.type(csv, 'runner-2, New Runner, Men-3k');
    await user.click(screen.getByRole('button', { name: 'Preview CSV' }));
    expect(await screen.findByText('1 valid rows')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply roster' }));
    expect(await screen.findByText('Roster saved: 1 added, 0 updated.')).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledWith('/api/races/7/roster/import', expect.objectContaining({ method: 'POST' }));
  });

  it('offers CSV and custom race categories as roster dropdown options', async () => {
    setRoute('/races/7/registration');
    render(<App />);
    const user = userEvent.setup();
    const category = await screen.findByRole('combobox', { name: 'Change Alex Runner category' });
    expect(within(category).getByRole('option', { name: 'Women-5k' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Add a category'), 'Men-10k');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Change Alex Runner category' })).getByRole('option', { name: 'Men-10k' })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Change Alex Runner category' }), 'Men-10k');
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('/api/races/7/roster/runner-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Alex Runner', category: 'Men-10k' }) })));
  });

  it('filters by exact race categories, sorts columns, and resets for a new race', async () => {
    categories = ['Women-5k', 'Men-3k', 'Men-3k-seniors'];
    finishes = [
      { ...runners[0], finished: true },
      { id: 2, idKey: 'runner-2', name: 'Sam Runner', category: 'Men-3k', finishedAt: '2026-10-24T00:02:00.000Z', finished: true },
      { id: 3, idKey: 'runner-3', name: 'Lee Runner', category: 'Men-3k-seniors', finishedAt: '2026-10-24T00:03:00.000Z', finished: true },
    ];
    races = [makeRace(), { ...makeRace(), id: 8, name: 'School Run' }];
    setRoute('/races/7/leaderboard');
    render(<App />);
    const user = userEvent.setup();
    const filter = await screen.findByRole('combobox', { name: 'Filter category' });
    expect(within(filter).getByRole('option', { name: 'Women-5k' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Men-3k' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Men-3k-seniors' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Women-5k' })).not.toBeInTheDocument();
    const transfer = await screen.findByRole('combobox', { name: 'Change Alex Runner category' });
    expect(within(transfer).getByRole('option', { name: 'Women-5k' })).toBeInTheDocument();
    await user.selectOptions(filter, 'Men-3k');
    expect(screen.getByText('Sam Runner')).toBeInTheDocument();
    expect(screen.queryByText('Lee Runner')).not.toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    await user.selectOptions(filter, '');
    expect(screen.getByText('Sam Runner')).toBeInTheDocument();
    expect(screen.getByText('Lee Runner')).toBeInTheDocument();

    const rows = () => Array.from(document.querySelectorAll('.leaderboard-row'));
    await user.click(screen.getByRole('button', { name: 'Sort by Runner' }));
    expect(rows().map((row) => row.querySelector('strong')?.textContent)).toEqual(['Alex Runner', 'Lee Runner', 'Sam Runner']);
    expect(rows().map((row) => row.querySelector('.place-number')?.textContent)).toEqual(['01', '03', '02']);
    await user.click(screen.getByRole('button', { name: 'Sort by Runner' }));
    expect(rows().map((row) => row.querySelector('strong')?.textContent)).toEqual(['Sam Runner', 'Lee Runner', 'Alex Runner']);
    expect(rows().map((row) => row.querySelector('.place-number')?.textContent)).toEqual(['02', '03', '01']);
    for (const label of ['Place', 'Runner', 'Category', 'Finish Time']) {
      const sortButton = screen.getByRole('button', { name: `Sort by ${label}` });
      await user.click(sortButton);
      expect(sortButton.closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'ascending');
      await user.click(sortButton);
      expect(sortButton.closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'descending');
    }
    await user.click(screen.getByRole('button', { name: /School Run/ }));
    await user.click(await screen.findByRole('button', { name: /Community Run/ }));
    await user.click(await screen.findByRole('link', { name: /Leaderboard/ }));
    expect(await screen.findByRole('combobox', { name: 'Filter category' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Sort by Finish Time' }).closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('records the top autocomplete result when Enter is pressed', async () => {
    setupApi('running');
    setRoute('/races/7/recording');
    render(<App />);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText('Type a runner name or race ID…');
    await user.type(input, 'Alex');
    expect(await screen.findByText('Alex Runner')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('/api/races/7/finishes', expect.objectContaining({ method: 'POST', body: JSON.stringify({ idKey: 'runner-1' }) })));
    expect(await screen.findByRole('status')).toHaveTextContent('Alex Runner recorded');
  });

  it('finds a runner by race ID and displays that ID in recommendations', async () => {
    setupApi('running');
    setRoute('/races/7/recording');
    render(<App />);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText('Type a runner name or race ID…');
    await user.type(input, 'RUNNER-1');
    expect(await screen.findByText('Alex Runner')).toBeInTheDocument();
    expect(screen.getByText('ID runner-1 · Women-5k')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('/api/races/7/finishes', expect.objectContaining({ method: 'POST', body: JSON.stringify({ idKey: 'runner-1' }) })));
  });

  it('switches the leaderboard table into a display-only fullscreen view', async () => {
    finishes = [{ ...runners[0], finished: true }];
    setRoute('/races/7/leaderboard');
    const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const originalRequestDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(function (this: HTMLElement) {
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this });
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      }),
    });
    const { container } = render(<App />);
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Full screen' }));
      await waitFor(() => expect(container.querySelector('.leaderboard-category-display')).toHaveTextContent('Women-5k'));
      expect(screen.getByRole('combobox', { name: 'Filter category' })).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Change Alex Runner category' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit Alex Runner' })).not.toBeInTheDocument();
    } finally {
      if (originalFullscreenDescriptor) Object.defineProperty(document, 'fullscreenElement', originalFullscreenDescriptor);
      else delete (document as Document & { fullscreenElement?: Element }).fullscreenElement;
      if (originalRequestDescriptor) Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', originalRequestDescriptor);
      else delete (HTMLElement.prototype as HTMLElement & { requestFullscreen?: () => Promise<void> }).requestFullscreen;
    }
  });

  it('keeps the projector leaderboard clean and directly addressable', async () => {
    setRoute('/races/7/leaderboard?projector=1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open projector' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Race workflow' })).getByRole('link', { name: /Leaderboard/ })).toHaveClass('active');
  });

  it('renders a read-only public leaderboard that filters, sorts, and refreshes on live updates', async () => {
    setRoute('/live/7');
    const publicBoard = {
      race: makeRace('running'),
      categories: ['5k_men', '3k_women'],
      finishes: [
        { name: 'Alice Runner', category: '5k_men', finishedAt: '2026-10-24T00:00:10.000Z' },
        { name: 'Bob Runner', category: '5k_men', finishedAt: '2026-10-24T00:00:15.000Z' },
        { name: 'Casey Runner', category: '3k_women', finishedAt: '2026-10-24T00:00:19.000Z' },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => publicBoard });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    publicSocket.on.mockClear();
    publicSocket.disconnect.mockClear();
    try {
      render(<App />);
      expect(await screen.findByRole('heading', { name: 'Community Run' })).toBeInTheDocument();
      expect(apiRequestMock).not.toHaveBeenCalled();
      const user = userEvent.setup();
      const categoryFilter = screen.getByRole('combobox', { name: 'Filter category' });
      await user.selectOptions(categoryFilter, '5k_men');
      expect(screen.getByText('Alice Runner')).toBeInTheDocument();
      expect(screen.getByText('Bob Runner')).toBeInTheDocument();
      expect(screen.getByText('01')).toBeInTheDocument();
      expect(screen.getByText('02')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Sort by Runner' }));
      const rows = Array.from(document.querySelectorAll('.public-board-table .leaderboard-row'));
      expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(['Alice Runner', 'Bob Runner']);
      const notify = publicSocket.on.mock.calls.find(([event]) => event === 'leaderboard:changed')?.[1];
      expect(notify).toBeTypeOf('function');
      notify?.({ raceId: 7 });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock).toHaveBeenLastCalledWith(`${window.location.origin}/api/public/races/7/leaderboard`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shows the share dialog in browser development and uses the backend LAN address', async () => {
    setRoute('/races/7/registration');
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Share leaderboard' }));
    expect(await screen.findByRole('heading', { name: 'Share leaderboard' })).toBeInTheDocument();
    expect(getPublicLeaderboardBaseUrlMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Leaderboard link' })).toHaveValue('http://192.168.1.20:41000/live/7');
    expect(screen.getByRole('img', { name: 'QR code for leaderboard link' })).toBeInTheDocument();
  });

  it('generates a local QR image without a third-party QR service', () => {
    render(<QrCode value="http://192.168.1.20:43210/live/7" />);
    const qr = screen.getByRole('img', { name: 'QR code for leaderboard link' });
    expect(qr).toHaveAttribute('viewBox', '0 0 45 45');
    expect(qr.querySelector('path')).toHaveAttribute('fill', '#101828');
  });
});
