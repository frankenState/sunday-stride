import fs from 'node:fs';
import path from 'node:path';

const MARKER_KEY = 'clean-start-reset-token';
function readRaceData(db) {
  return {
    races: db.prepare('SELECT * FROM races ORDER BY id').all(),
    roster: db.prepare('SELECT * FROM roster ORDER BY race_id, id_key').all(),
    categories: db.prepare('SELECT * FROM race_categories ORDER BY race_id, label COLLATE NOCASE').all(),
    finishes: db.prepare('SELECT * FROM finishes ORDER BY id').all(),
  };
}

function hasRaceData(data) {
  return Object.values(data).some((rows) => rows.length > 0);
}

function makeBackup(data, backupDir, token) {
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `fun-run-pre-clean-start-${timestamp}.json`);
  const snapshot = { createdAt: new Date().toISOString(), resetToken: token, ...data };
  const serialized = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(backupPath, serialized, { flag: 'wx' });

  let verified;
  try {
    verified = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  } catch (error) {
    throw new Error(`Clean-start backup could not be read back. Database was not cleared. Backup: ${backupPath}`, { cause: error });
  }
  for (const key of ['races', 'roster', 'categories', 'finishes']) {
    if (JSON.stringify(verified[key]) !== JSON.stringify(data[key])) {
      throw new Error(`Clean-start backup verification failed. Database was not cleared. Backup: ${backupPath}`);
    }
  }
  return backupPath;
}

/** Archive and clear race data once for a tokenized packaged release. */
export function resetDatabaseOnce(db, { token, backupDir, logger = console } = {}) {
  if (!token) return { reset: false, reason: 'no-token' };

  const prior = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(MARKER_KEY);
  if (prior?.value === token) return { reset: false, reason: 'already-reset' };

  const data = readRaceData(db);
  const backupPath = hasRaceData(data) ? makeBackup(data, backupDir, token) : null;

  db.transaction(() => {
    for (const table of ['finishes', 'roster', 'race_categories', 'races']) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.prepare('DELETE FROM sqlite_sequence WHERE name IN (?, ?)').run('races', 'finishes');
    db.prepare(`INSERT INTO app_metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(MARKER_KEY, token);
  })();

  logger?.info?.(backupPath
    ? `Archived ${data.races.length} races and ${data.finishes.length} finishes to ${backupPath}; clean-start reset completed.`
    : 'No existing race data found; clean-start reset completed.');
  return { reset: true, backupPath, raceCount: data.races.length, finishCount: data.finishes.length };
}
