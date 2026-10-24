import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createCurrentSchema, tableExists } from './schema.js';
import { resetDatabaseOnce } from './cleanStart.js';

function backUpLegacyData(db, backupDir) {
  const runners = db.prepare('SELECT * FROM runners ORDER BY id').all();
  const raceState = tableExists(db, 'race_state') ? db.prepare('SELECT * FROM race_state').all() : [];
  fs.mkdirSync(backupDir, { recursive: true });
  const fileName = `fun-run-pre-migration-${new Date().toISOString().replace(/:/g, '-')}.json`;
  const backupPath = path.join(backupDir, fileName);
  const snapshot = { createdAt: new Date().toISOString(), raceState, runners };
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), { flag: 'wx' });

  const verified = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (JSON.stringify(verified.raceState) !== JSON.stringify(raceState) || JSON.stringify(verified.runners) !== JSON.stringify(runners)) {
    throw new Error(`Legacy database backup verification failed. Migration stopped. Backup: ${backupPath}`);
  }
  return { backupPath, runnerCount: runners.length };
}

function migrateLegacySchema(db, backupDir, logger) {
  if (tableExists(db, 'races') || !tableExists(db, 'runners')) return;

  const backup = backUpLegacyData(db, backupDir);
  db.transaction(() => {
    db.exec('DROP TABLE runners');
    if (tableExists(db, 'race_state')) db.exec('DROP TABLE race_state');
  })();
  logger?.info?.(`Archived ${backup.runnerCount} legacy finishes to ${backup.backupPath}`);
}

export function initializeDatabase(db, { backupDir, logger = console, cleanStartToken } = {}) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateLegacySchema(db, backupDir, logger);
  createCurrentSchema(db);
  resetDatabaseOnce(db, { token: cleanStartToken, backupDir, logger });
  return db;
}

export function openDatabase({ databasePath, backupDir, logger, cleanStartToken } = {}) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    return initializeDatabase(db, { backupDir, logger, cleanStartToken });
  } catch (error) {
    db.close();
    throw error;
  }
}
