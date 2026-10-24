import { createRaceService, HttpError } from './raceService.js';

export function getPublicLeaderboard(db, raceId) {
  const id = Number(raceId);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'Race not found.');
  const races = createRaceService(db);
  const race = races.listRaces().find((item) => item.id === id);
  if (!race) throw new HttpError(404, 'Race not found.');

  return {
    race: {
      id: race.id,
      name: race.name,
      race_date: race.race_date,
      status: race.status,
      start_at: race.start_at,
      completed_at: race.completed_at,
    },
    categories: races.getCategories(id),
    finishes: races.listFinishes(id).map(({ name, category, finishedAt }) => ({ name, category, finishedAt })),
  };
}
