import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/database/initialize.js';

test('legacy data is verified in backup before its tables are replaced', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fun-run-migration-'));
  const databasePath = path.join(dir, 'legacy.sqlite');
  const backupDir = path.join(dir, 'backups');
  const legacy = new Database(databasePath);
  legacy.exec('CREATE TABLE runners(id INTEGER PRIMARY KEY,name TEXT,category TEXT,finished_at TEXT); CREATE TABLE race_state(id INTEGER PRIMARY KEY,started_at TEXT);');
  legacy.prepare('INSERT INTO runners VALUES(1,?,?,?)').run('Runner One', '3k', '2026-10-24T00:00:05.000Z');
  legacy.prepare('INSERT INTO race_state VALUES(1,?)').run('2026-10-24T00:00:00.000Z');
  legacy.close();

  const db = openDatabase({ databasePath, backupDir, logger: { info() {} } });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const files = fs.readdirSync(backupDir);
  assert.equal(files.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));
  assert.equal(backup.runners.length, 1);
  assert.equal(backup.runners[0].name, 'Runner One');
  assert.equal(backup.raceState[0].started_at, '2026-10-24T00:00:00.000Z');
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='runners'").get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM races').get().n, 0);
});
