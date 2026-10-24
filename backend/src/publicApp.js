import express from 'express';
import { createPublicApiRouter } from './routes/publicApi.js';

export function createPublicApp({ db, frontendDist }) {
  const app = express();
  app.use('/api/public', createPublicApiRouter(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Public API route not found.' }));
  app.use(express.static(frontendDist, { index: false, fallthrough: true }));
  app.get('/live/:raceId', (_req, res) => res.sendFile('index.html', { root: frontendDist }));
  app.use((_req, res) => res.status(404).json({ error: 'Public route not found.' }));
  app.use((error, _req, res, _next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'An unexpected public service error occurred.' : error.message });
  });
  return app;
}
