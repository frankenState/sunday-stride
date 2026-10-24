import { Router } from 'express';
import { getPublicLeaderboard } from '../services/publicLeaderboard.js';

export function createPublicApiRouter(db) {
  const router = Router();
  router.get('/races/:raceId/leaderboard', (req, res) => {
    res.json(getPublicLeaderboard(db, req.params.raceId));
  });
  return router;
}
