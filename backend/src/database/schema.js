export const SCHEMA_VERSION = 3;

export function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function createCurrentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS races (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      race_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'setup' CHECK(status IN ('setup','ready','running','completed')),
      start_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roster (
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      id_key TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      PRIMARY KEY (race_id, id_key)
    );
    CREATE TABLE IF NOT EXISTS finishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL,
      runner_key TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      UNIQUE (race_id, runner_key),
      FOREIGN KEY (race_id, runner_key) REFERENCES roster(race_id, id_key) ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS race_categories (
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      label TEXT COLLATE NOCASE NOT NULL,
      PRIMARY KEY (race_id, label)
    );
    INSERT OR IGNORE INTO race_categories(race_id, label)
      SELECT race_id, category FROM roster;
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
