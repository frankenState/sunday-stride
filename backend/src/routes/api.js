import { Router } from 'express';
import { createRaceService } from '../services/raceService.js';

export function createApiRouter({ db, emitRace, getPublicBaseUrl = () => null }) {
  const router = Router();
  const races = createRaceService(db, emitRace);
  const raceId = (req) => Number(req.params.raceId);

  router.get('/server/share', (_req, res) => res.json({ publicBaseUrl: getPublicBaseUrl() }));
  router.get('/races', (_req, res) => res.json(races.listRaces()));
  router.post('/races', (req, res) => res.status(201).json(races.createRace(req.body ?? {})));
  router.get('/races/:raceId/roster', (req, res) => res.json(races.getRoster(raceId(req))));
  router.get('/races/:raceId/categories', (req, res) => res.json(races.getCategories(raceId(req))));
  router.post('/races/:raceId/categories', (req, res) => res.status(201).json(races.addCategory(raceId(req), req.body?.category)));
  router.post('/races/:raceId/roster/import', (req, res) => res.json(races.importRoster(raceId(req), req.body ?? {})));
  router.patch('/races/:raceId/roster/:key', (req, res) => res.json(races.updateRunner(raceId(req), req.params.key, req.body ?? {})));
  router.delete('/races/:raceId/roster/:key', (req, res) => res.json(races.deleteRosterRunner(raceId(req), req.params.key)));
  router.get('/races/:raceId/roster/search', (req, res) => res.json(races.searchRoster(raceId(req), req.query.q)));
  router.get('/races/:raceId/finishes', (req, res) => res.json(races.listFinishes(raceId(req))));
  router.post('/races/:raceId/finishes', (req, res) => res.status(201).json(races.recordFinish(raceId(req), req.body?.idKey)));
  router.patch('/races/:raceId/finishes/:key', (req, res) => res.json(races.editFinish(raceId(req), req.params.key, req.body ?? {})));
  router.delete('/races/:raceId/finishes/:key', (req, res) => res.json(races.deleteFinish(raceId(req), req.params.key)));
  router.post('/races/:raceId/start', (req, res) => res.json(races.startRace(raceId(req))));
  router.post('/races/:raceId/complete', (req, res) => res.json(races.completeRace(raceId(req))));
  router.delete('/races/:raceId/finishes', (req, res) => res.json(races.resetRace(raceId(req))));
  return router;
}
