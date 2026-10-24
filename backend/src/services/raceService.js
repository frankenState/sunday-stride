import { previewRosterCsv } from './csvImport.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const fail = (status, message) => { throw new HttpError(status, message); };

export function createRaceService(db, emitRace = () => {}) {
  const getRace = (id) => db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM roster p WHERE p.race_id=r.id) roster_count,
      (SELECT COUNT(*) FROM finishes f WHERE f.race_id=r.id) finish_count
    FROM races r WHERE r.id=?
  `).get(id);

  const requireRace = (id) => getRace(id) ?? fail(404, 'Race not found.');
  const getFinish = (raceId, key) => db.prepare(`
    SELECT f.id, f.race_id raceId, f.runner_key idKey, p.name, p.category, f.finished_at finishedAt
    FROM finishes f JOIN roster p ON p.race_id=f.race_id AND p.id_key=f.runner_key
    WHERE f.race_id=? AND f.runner_key=?
  `).get(raceId, key);

  function listRaces() {
    return db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM roster p WHERE p.race_id=r.id) rosterCount,
        (SELECT COUNT(*) FROM finishes f WHERE f.race_id=r.id) finishCount
      FROM races r ORDER BY id DESC
    `).all();
  }

  function createRace({ name: rawName, raceDate: rawDate } = {}) {
    const name = String(rawName ?? '').trim();
    const date = String(rawDate ?? '').trim() || new Date().toISOString().slice(0, 10);
    if (!name) fail(400, 'Race name is required.');
    if (name.length > 120) fail(400, 'Race name must be 120 characters or fewer.');
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) fail(400, 'Enter a valid race date.');
    const result = db.prepare('INSERT INTO races(name,race_date,created_at) VALUES(?,?,?)').run(name, date, new Date().toISOString());
    const race = getRace(result.lastInsertRowid);
    emitRace('race:created', race.id, { race });
    return race;
  }

  function getRoster(raceId) {
    requireRace(raceId);
    return db.prepare(`
      SELECT p.id_key idKey,p.name,p.category,
        EXISTS(SELECT 1 FROM finishes f WHERE f.race_id=p.race_id AND f.runner_key=p.id_key) finished
      FROM roster p WHERE p.race_id=? ORDER BY p.name COLLATE NOCASE
    `).all(raceId);
  }

  function getCategories(raceId) {
    requireRace(raceId);
    return db.prepare('SELECT label FROM race_categories WHERE race_id=? ORDER BY label COLLATE NOCASE').all(raceId).map((row) => row.label);
  }

  function addCategory(raceId, rawCategory) {
    requireRace(raceId);
    const category = String(rawCategory ?? '').trim();
    if (!category || category.length > 100) fail(400, 'Category must be between 1 and 100 characters.');
    db.prepare('INSERT OR IGNORE INTO race_categories(race_id,label) VALUES(?,?)').run(raceId, category);
    const categories = getCategories(raceId);
    emitRace('categories:updated', raceId, { categories });
    return categories;
  }

  function importRoster(raceId, { csv, commit = false } = {}) {
    const race = requireRace(raceId);
    if (race.status === 'running' || race.status === 'completed') fail(409, 'Roster imports are available before the race starts.');
    const preview = previewRosterCsv(csv);
    const existing = new Set(db.prepare('SELECT id_key FROM roster WHERE race_id=?').all(raceId).map((row) => row.id_key));
    const additions = preview.records.filter((record) => !existing.has(record.idKey)).length;
    const updates = preview.records.length - additions;
    if (!commit) return { ...preview, additions, updates };
    if (!preview.records.length || preview.errors.length) fail(400, 'Fix all invalid rows before applying the import.');

    db.transaction(() => {
      const upsert = db.prepare(`
        INSERT INTO roster(race_id,id_key,name,category) VALUES(?,?,?,?)
        ON CONFLICT(race_id,id_key) DO UPDATE SET name=excluded.name,category=excluded.category
      `);
      const addCategory = db.prepare('INSERT OR IGNORE INTO race_categories(race_id,label) VALUES(?,?)');
      for (const record of preview.records) {
        upsert.run(raceId, record.idKey, record.name, record.category);
        addCategory.run(raceId, record.category);
      }
      db.prepare("UPDATE races SET status=CASE WHEN status='setup' THEN 'ready' ELSE status END WHERE id=?").run(raceId);
    })();
    const updatedRace = getRace(raceId);
    emitRace('roster:imported', raceId, { race: updatedRace });
    return { ...preview, additions, updates, applied: true, race: updatedRace };
  }

  function searchRoster(raceId, query) {
    requireRace(raceId);
    const q = String(query ?? '').trim();
    if (!q) return [];
    return db.prepare(`
      SELECT p.id_key idKey,p.name,p.category,
        EXISTS(SELECT 1 FROM finishes f WHERE f.race_id=p.race_id AND f.runner_key=p.id_key) finished
      FROM roster p WHERE p.race_id=?
        AND (p.name LIKE ? COLLATE NOCASE OR p.id_key LIKE ? COLLATE NOCASE)
      ORDER BY CASE
        WHEN p.name = ? COLLATE NOCASE OR p.id_key = ? COLLATE NOCASE THEN 0
        WHEN p.name LIKE ? COLLATE NOCASE OR p.id_key LIKE ? COLLATE NOCASE THEN 1
        ELSE 2 END,
        p.name COLLATE NOCASE
      LIMIT 8
    `).all(raceId, `%${q}%`, `%${q}%`, q, q, `${q}%`, `${q}%`);
  }

  function listFinishes(raceId) {
    requireRace(raceId);
    return db.prepare(`
      SELECT f.id,f.race_id raceId,f.runner_key idKey,p.name,p.category,f.finished_at finishedAt
      FROM finishes f JOIN roster p ON p.race_id=f.race_id AND p.id_key=f.runner_key
      WHERE f.race_id=? ORDER BY f.finished_at,f.id
    `).all(raceId);
  }

  function recordFinish(raceId, idKey) {
    const race = requireRace(raceId);
    if (race.status !== 'running' || !race.start_at) fail(409, 'Check-in is locked until the race is running.');
    const key = String(idKey ?? '').trim();
    if (!db.prepare('SELECT 1 FROM roster WHERE race_id=? AND id_key=?').get(raceId, key)) fail(404, 'Runner is not in this race roster.');
    if (db.prepare('SELECT 1 FROM finishes WHERE race_id=? AND runner_key=?').get(raceId, key)) fail(409, 'This runner already has a finish recorded.');
    const finishedAt = new Date().toISOString();
    db.prepare('INSERT INTO finishes(race_id,runner_key,finished_at) VALUES(?,?,?)').run(raceId, key, finishedAt);
    const finish = getFinish(raceId, key);
    emitRace('runner:finished', raceId, { runner: finish });
    return finish;
  }

  function editFinish(raceId, key, changes = {}) {
    requireRace(raceId);
    const current = getFinish(raceId, key);
    if (!current) fail(404, 'Finish not found.');
    const name = String(changes.name ?? current.name).trim();
    const category = String(changes.category ?? current.category).trim();
    const finishedAt = String(changes.finishedAt ?? current.finishedAt);
    if (!name || name.length > 120 || !category || category.length > 100 || !Number.isFinite(Date.parse(finishedAt))) {
      fail(400, 'Enter a valid name, category, and finish time.');
    }
    db.transaction(() => {
      db.prepare('UPDATE roster SET name=?,category=? WHERE race_id=? AND id_key=?').run(name, category, raceId, key);
      db.prepare('INSERT OR IGNORE INTO race_categories(race_id,label) VALUES(?,?)').run(raceId, category);
      db.prepare('UPDATE finishes SET finished_at=? WHERE race_id=? AND runner_key=?').run(new Date(finishedAt).toISOString(), raceId, key);
    })();
    const updated = getFinish(raceId, key);
    emitRace('runner:updated', raceId, { runner: updated });
    return updated;
  }

  function updateRunner(raceId, key, changes = {}) {
    requireRace(raceId);
    const current = db.prepare('SELECT name,category FROM roster WHERE race_id=? AND id_key=?').get(raceId, key);
    if (!current) fail(404, 'Runner not found in this roster.');
    const name = String(changes.name ?? current.name).trim();
    const category = String(changes.category ?? current.category).trim();
    if (!name || name.length > 120) fail(400, 'Name must be between 1 and 120 characters.');
    if (!category || category.length > 100) fail(400, 'Category must be between 1 and 100 characters.');
    db.transaction(() => {
      db.prepare('UPDATE roster SET name=?,category=? WHERE race_id=? AND id_key=?').run(name, category, raceId, key);
      db.prepare('INSERT OR IGNORE INTO race_categories(race_id,label) VALUES(?,?)').run(raceId, category);
    })();
    const runner = getFinish(raceId, key) ?? db.prepare('SELECT id_key idKey,name,category FROM roster WHERE race_id=? AND id_key=?').get(raceId, key);
    emitRace('roster:updated', raceId, { runner });
    if (runner.finishedAt) emitRace('runner:updated', raceId, { runner });
    return runner;
  }

  function changeCategory(raceId, key, rawCategory) {
    return updateRunner(raceId, key, { category: rawCategory });
  }

  function deleteRosterRunner(raceId, key) {
    requireRace(raceId);
    if (db.prepare('SELECT 1 FROM finishes WHERE race_id=? AND runner_key=?').get(raceId, key)) {
      fail(409, 'Delete this runner’s finish before deleting them from the roster.');
    }
    const result = db.prepare('DELETE FROM roster WHERE race_id=? AND id_key=?').run(raceId, key);
    if (!result.changes) fail(404, 'Runner not found in this roster.');
    emitRace('roster:deleted', raceId, { idKey: key });
    return { ok: true };
  }

  function deleteFinish(raceId, key) {
    requireRace(raceId);
    const result = db.prepare('DELETE FROM finishes WHERE race_id=? AND runner_key=?').run(raceId, key);
    if (!result.changes) fail(404, 'Finish not found.');
    emitRace('runner:deleted', raceId, { idKey: key });
    return { ok: true };
  }

  function startRace(raceId) {
    const race = requireRace(raceId);
    if (race.status !== 'ready' || race.roster_count < 1) fail(409, 'Import a roster before starting this race.');
    if (db.prepare("SELECT id FROM races WHERE status='running'").get()) fail(409, 'Another race is already running. Complete or reset it first.');
    const startAt = new Date().toISOString();
    db.prepare("UPDATE races SET status='running',start_at=?,completed_at=NULL WHERE id=?").run(startAt, raceId);
    const updated = getRace(raceId);
    emitRace('race:started', raceId, { race: updated });
    return updated;
  }

  function completeRace(raceId) {
    const race = requireRace(raceId);
    if (race.status !== 'running') fail(409, 'Only a running race can be completed.');
    db.prepare("UPDATE races SET status='completed',completed_at=? WHERE id=?").run(new Date().toISOString(), raceId);
    const updated = getRace(raceId);
    emitRace('race:completed', raceId, { race: updated });
    return updated;
  }

  function resetRace(raceId) {
    requireRace(raceId);
    db.transaction(() => {
      db.prepare('DELETE FROM finishes WHERE race_id=?').run(raceId);
      db.prepare(`UPDATE races SET status=CASE WHEN EXISTS(SELECT 1 FROM roster WHERE race_id=?)
        THEN 'ready' ELSE 'setup' END,start_at=NULL,completed_at=NULL WHERE id=?`).run(raceId, raceId);
    })();
    const updated = getRace(raceId);
    emitRace('race:reset', raceId, { race: updated });
    return updated;
  }

  return { listRaces, createRace, getRoster, getCategories, addCategory, importRoster, searchRoster, listFinishes,
    recordFinish, editFinish, updateRunner, changeCategory, deleteRosterRunner, deleteFinish, startRace, completeRace, resetRace };
}
