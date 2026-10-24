import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/database/initialize.js';
import { createRaceService } from '../src/services/raceService.js';

test('tokenized clean start backs up all race data, clears once, and preserves later data', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fun-run-clean-start-'));
  const databasePath = path.join(tempDir, 'races.sqlite');
  const backupDir = path.join(tempDir, 'backups');
  const token = 'release-reset-once';

  try {
    let db = openDatabase({ databasePath, backupDir, logger: { info() {} } });
    const races = createRaceService(db);
    const race = races.createRace({ name: 'Data to Archive', raceDate: '2026-10-24' });
    races.importRoster(race.id, { csv: 'bib-1,Alex Runner,Women-5k\nbib-2,Sam Runner,Men-3k-seniors', commit: true });
    races.addCategory(race.id, 'Open-10k');
    races.startRace(race.id);
    const finish = races.recordFinish(race.id, 'bib-1');
    db.close();

    // A normal development launch has no reset token and keeps the data.
    db = openDatabase({ databasePath, backupDir, logger: { info() {} } });
    assert.equal(createRaceService(db).listRaces().length, 1);
    db.close();

    db = openDatabase({ databasePath, backupDir, cleanStartToken: token, logger: { info() {} } });
    assert.deepEqual(createRaceService(db).listRaces(), []);
    assert.deepEqual(db.prepare('SELECT * FROM roster').all(), []);
    assert.deepEqual(db.prepare('SELECT * FROM race_categories').all(), []);
    assert.deepEqual(db.prepare('SELECT * FROM finishes').all(), []);
    const marker = db.prepare("SELECT value FROM app_metadata WHERE key='clean-start-reset-token'").get();
    assert.equal(marker.value, token);

    const backups = fs.readdirSync(backupDir).filter((name) => name.startsWith('fun-run-pre-clean-start-'));
    assert.equal(backups.length, 1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), 'utf8'));
    assert.equal(backup.races.length, 1);
    assert.equal(backup.races[0].status, 'running');
    assert.ok(Date.parse(backup.races[0].start_at));
    assert.equal(backup.roster.length, 2);
    assert.deepEqual(backup.categories.map((row) => row.label).sort(), ['Men-3k-seniors', 'Open-10k', 'Women-5k']);
    assert.equal(backup.finishes.length, 1);
    assert.equal(backup.finishes[0].runner_key, 'bib-1');
    assert.equal(backup.finishes[0].finished_at, finish.finishedAt);
    db.close();

    // A later launch with the same release token must not reset newly entered data.
    db = openDatabase({ databasePath, backupDir, cleanStartToken: token, logger: { info() {} } });
    const later = createRaceService(db).createRace({ name: 'New Release Data' });
    assert.equal(later.name, 'New Release Data');
    assert.equal(createRaceService(db).listRaces().length, 1);
    assert.equal(fs.readdirSync(backupDir).filter((name) => name.startsWith('fun-run-pre-clean-start-')).length, 1);
    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('clean start stops before clearing data when backup creation fails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fun-run-clean-start-failure-'));
  const databasePath = path.join(tempDir, 'races.sqlite');
  const backupDir = path.join(tempDir, 'not-a-directory');
  try {
    fs.writeFileSync(backupDir, 'prevent backup directory creation');
    let db = openDatabase({ databasePath, backupDir: path.join(tempDir, 'initial-backups'), logger: { info() {} } });
    createRaceService(db).createRace({ name: 'Keep Me' });
    db.close();
    assert.throws(() => openDatabase({ databasePath, backupDir, cleanStartToken: 'failsafe', logger: { info() {} } }));
    db = openDatabase({ databasePath, backupDir: path.join(tempDir, 'initial-backups'), logger: { info() {} } });
    assert.equal(createRaceService(db).listRaces()[0].name, 'Keep Me');
    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
