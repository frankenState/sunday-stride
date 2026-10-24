import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { io, Socket } from 'socket.io-client';

let apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';
let initialization: Promise<void> | null = null;

export function initializeDesktopBridge(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let readyFromEvent = false;
    const eventReady = new Promise<void>((resolve) => {
      void listen<{ baseUrl: string }>('backend-ready', (event) => {
        apiBaseUrl = event.payload.baseUrl;
        readyFromEvent = true;
        resolve();
        unlisten?.();
      }).then((stop) => { unlisten = stop; });
    });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const readyUrl = await invoke<string | null>('get_backend_url');
      if (readyUrl) {
        apiBaseUrl = readyUrl;
        unlisten?.();
        return;
      }
      await Promise.race([eventReady, new Promise<void>((resolve) => setTimeout(resolve, 150))]);
      if (readyFromEvent) return;
    }
    throw new Error('The race service did not start. Close and reopen Sunday Stride.');
  })();
  return initialization;
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  await initializeDesktopBridge();
  const response = await fetch(`${apiBaseUrl}${url}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'The request could not be completed.');
  return data as T;
}

export async function getPublicLeaderboardBaseUrl(): Promise<string | null> {
  if (isTauri()) return await invoke<string | null>('get_public_base_url');
  const response = await apiRequest<{ publicBaseUrl: string | null }>('/api/server/share');
  return response.publicBaseUrl;
}

export function createRaceSocket(): Socket {
  return io(apiBaseUrl, { autoConnect: false });
}

export async function openProjectorWindow(): Promise<void> {
  if (!isTauri()) {
    window.open('/leaderboard?projector=1', '_blank', 'noopener,noreferrer');
    return;
  }
  const current = await WebviewWindow.getByLabel('projector');
  if (current) {
    await current.show();
    await current.setFocus();
    return;
  }
  const projector = new WebviewWindow('projector', {
    title: 'Sunday Stride · Projector Leaderboard',
    url: '/#/leaderboard?projector=1',
    width: 1440,
    height: 900,
    center: true,
  });
  await new Promise<void>((resolve, reject) => {
    projector.once('tauri://created', () => resolve()).catch(reject);
    projector.once('tauri://error', (event) => reject(new Error(String(event.payload)))).catch(reject);
  });
}

export const isDesktopApp = isTauri();
