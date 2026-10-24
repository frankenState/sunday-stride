import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database/initialize.js';

test('HTTP workflow creates a race, imports a roster, records a finish, and completes the clock', async () => {
  const db = openDatabase({ databasePath: ':memory:', backupDir: 'unused', logger: { info() {} } });
  const events = [];
  const app = createApp({ db, emitRace: (event, raceId, payload) => events.push({ event, raceId, payload }) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const json = async (url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    const created = await json('/races', { method: 'POST', body: JSON.stringify({ name: 'Workflow Run', raceDate: '2026-10-24' }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Workflow Run');
    const raceId = created.body.id;

    const invalidCreate = await json('/races', { method: 'POST', body: JSON.stringify({ name: 'Bad date', raceDate: '2026-02-31' }) });
    assert.equal(invalidCreate.status, 400);

    const csv = 'id_key,name,category\nrunner-1,Frank Lou,Women-3k\nrunner-2,Mark Collins,Men-5k';
    const preview = await json(`/races/${raceId}/roster/import`, { method: 'POST', body: JSON.stringify({ csv }) });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.additions, 2);
    const imported = await json(`/races/${raceId}/roster/import`, { method: 'POST', body: JSON.stringify({ csv, commit: true }) });
    assert.equal(imported.body.applied, true);
    assert.equal(imported.body.race.status, 'ready');
    assert.equal((await json(`/races/${raceId}/roster`)).body.length, 2);

    const started = await json(`/races/${raceId}/start`, { method: 'POST' });
    assert.equal(started.body.status, 'running');
    assert.ok(started.body.start_at);
    const finish = await json(`/races/${raceId}/finishes`, { method: 'POST', body: JSON.stringify({ idKey: 'runner-1' }) });
    assert.equal(finish.status, 201);
    assert.equal(finish.body.idKey, 'runner-1');
    assert.ok(Date.parse(finish.body.finishedAt) >= Date.parse(started.body.start_at));
    assert.equal((await json(`/races/${raceId}/finishes`)).body.length, 1);
    assert.equal((await json(`/races/${raceId}/finishes`, { method: 'POST', body: JSON.stringify({ idKey: 'runner-1' }) })).status, 409);

    const edited = await json(`/races/${raceId}/finishes/runner-1`, { method: 'PATCH', body: JSON.stringify({ name: 'Frank Corrected', category: 'Women-3k-seniors' }) });
    assert.equal(edited.body.name, 'Frank Corrected');
    assert.equal((await json(`/races/${raceId}/roster`)).body.find((runner) => runner.idKey === 'runner-1').category, 'Women-3k-seniors');

    const completed = await json(`/races/${raceId}/complete`, { method: 'POST' });
    assert.equal(completed.body.status, 'completed');
    assert.ok(completed.body.completed_at);
    assert.equal((await json(`/races/${raceId}/finishes`, { method: 'POST', body: JSON.stringify({ idKey: 'runner-2' }) })).status, 409);
    assert.deepEqual(events.map((event) => event.event), ['race:created', 'roster:imported', 'race:started', 'runner:finished', 'runner:updated', 'race:completed']);
    assert.ok(events.every((event) => event.raceId === raceId));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
