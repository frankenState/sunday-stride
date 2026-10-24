import cors from 'cors';
import express from 'express';
import { createApiRouter } from './routes/api.js';

export function createApp({ db, emitRace, getPublicBaseUrl, frontendDist, serveFrontend = false }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createApiRouter({ db, emitRace, getPublicBaseUrl }));

  if (serveFrontend) {
    app.use(express.static(frontendDist));
    app.get(/.*/, (_req, res) => res.sendFile(`${frontendDist}/index.html`));
  }

  app.use((error, _req, res, _next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'An unexpected server error occurred.' : error.message });
  });
  return app;
}
