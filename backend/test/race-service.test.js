import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/database/initialize.js';
import { createRaceService } from '../src/services/raceService.js';

test('race service imports rosters, scopes finishes, enforces lifecycle, and emits race-scoped updates', () => {
  const db = openDatabase({ databasePath: ':memory:', backupDir: 'unused', logger: { info() {} } });
  const events = [];
  const races = createRaceService(db, (event, raceId, data) => events.push({ event, raceId, data }));
  try {
    const first = races.createRace({ name: 'API Test Race', raceDate: '2026-10-24' });
    const headeredCsv = [
      'id_key,name,category',
      'm1,Mark Collins,Men-5k',
      'p1,Peter Obrien,Men-3k-seniors',
      'f1,Frank Lou,Women-3k',
    ].join('\n');
    const preview = races.importRoster(first.id, { csv: headeredCsv });
    assert.equal(preview.records.length, 3);
    assert.equal(preview.additions, 3);
    assert.equal(races.importRoster(first.id, { csv: headeredCsv, commit: true }).race.status, 'ready');

    const badRows = races.importRoster(first.id, { csv: 'x1,Runner One,3k\nx1,Runner Two,5k\ninvalid,,Women-3k' });
    assert.equal(badRows.errors.length, 2);
    assert.equal(badRows.records.length, 1);

    const upsert = races.importRoster(first.id, { csv: 'm1,Mark Updated,Men-10k\nextra,New Runner,Women-3k', commit: true });
    assert.equal(upsert.additions, 1);
    assert.equal(upsert.updates, 1);
    assert.equal(races.getRoster(first.id).length, 4);
    assert.equal(races.getRoster(first.id).find((runner) => runner.idKey === 'm1').name, 'Mark Updated');
    assert.deepEqual(races.getCategories(first.id).sort(), ['Men-10k', 'Men-3k-seniors', 'Men-5k', 'Women-3k']);
    races.addCategory(first.id, 'Open-10k');
    assert.ok(races.getCategories(first.id).includes('Open-10k'));
    races.addCategory(first.id, 'open-10k');
    assert.equal(races.getCategories(first.id).filter((category) => category.toLowerCase() === 'open-10k').length, 1);

    const second = races.createRace({ name: 'Second Race' });
    races.importRoster(second.id, { csv: 'b1,Runner B,Men-5k', commit: true });
    const started = races.startRace(first.id);
    assert.equal(started.status, 'running');
    assert.ok(started.start_at);
    assert.throws(() => races.startRace(second.id), { status: 409 });
    assert.equal(races.searchRoster(first.id, 'frank')[0].idKey, 'f1');

    const recorded = races.recordFinish(first.id, 'f1');
    assert.ok(Date.parse(recorded.finishedAt) >= Date.parse(started.start_at));
    assert.equal(events.at(-1).event, 'runner:finished');
    assert.equal(events.at(-1).raceId, first.id);
    assert.throws(() => races.recordFinish(first.id, 'f1'), { status: 409 });
    assert.throws(() => races.recordFinish(second.id, 'b1'), { status: 409 });

    const transfer = races.changeCategory(first.id, 'f1', 'Women-3k-seniors');
    assert.equal(transfer.category, 'Women-3k-seniors');
    const edited = races.editFinish(first.id, 'f1', {
      name: 'Frank Lou Corrected', category: 'Women-5k', finishedAt: recorded.finishedAt,
    });
    assert.equal(edited.name, 'Frank Lou Corrected');
    assert.equal(races.getRoster(first.id).find((runner) => runner.idKey === 'f1').name, 'Frank Lou Corrected');
    assert.equal(races.getRoster(second.id).length, 1);
    assert.throws(() => races.deleteRosterRunner(first.id, 'f1'), { status: 409 });
    races.updateRunner(first.id, 'm1', { name: 'Mark Renamed', category: 'Open-10k' });
    assert.equal(races.getRoster(first.id).find((runner) => runner.idKey === 'm1').name, 'Mark Renamed');

    assert.equal(races.completeRace(first.id).status, 'completed');
    assert.throws(() => races.recordFinish(first.id, 'm1'), { status: 409 });
    assert.equal(races.resetRace(first.id).status, 'ready');
    assert.equal(races.listFinishes(first.id).length, 0);
    assert.equal(races.getRoster(first.id).length, 4);
    assert.equal(races.listFinishes(second.id).length, 0);
    assert.equal(races.deleteRosterRunner(first.id, 'm1').ok, true);
    assert.equal(races.getRoster(first.id).length, 3);
  } finally {
    db.close();
  }
});

test('roster search matches names and ID keys with case-insensitive ranking and an eight-result limit', () => {
  const db = openDatabase({ databasePath: ':memory:', backupDir: 'unused', logger: { info() {} } });
  const races = createRaceService(db);
  try {
    const race = races.createRace({ name: 'ID Search Race' });
    const csv = ['id_key,name,category', ...Array.from({ length: 10 }, (_, index) => `bib-${String(index + 1).padStart(2, '0')},Runner ${String(index + 1).padStart(2, '0')},Open-5k`)].join('\n');
    races.importRoster(race.id, { csv, commit: true });

    assert.equal(races.searchRoster(race.id, 'BIB-03')[0].idKey, 'bib-03');
    assert.equal(races.searchRoster(race.id, 'runner 04')[0].idKey, 'bib-04');
    assert.equal(races.searchRoster(race.id, 'nner 0')[0].idKey, 'bib-01');
    assert.equal(races.searchRoster(race.id, 'runner').length, 8);
  } finally {
    db.close();
  }
});
