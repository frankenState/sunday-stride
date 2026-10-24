import fs from 'node:fs';
import path from 'node:path';

const databaseFile = /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i;

function findDatabaseFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return databaseFile.test(target) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    return findDatabaseFiles(path.join(target, entry.name));
  });
}

export function assertNoBundledDatabases(root) {
  const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const resources = config.bundle?.resources ?? {};
  const offenders = [];
  for (const source of Object.keys(resources)) {
    const normalized = source.replaceAll('\\', '/');
    if (databaseFile.test(normalized.replace(/\/$/, ''))) offenders.push(path.resolve(root, 'src-tauri', source));
    else offenders.push(...findDatabaseFiles(path.resolve(root, 'src-tauri', source)));
  }
  if (offenders.length) {
    throw new Error(`SQLite/database files must never be bundled with the app:\n${offenders.map((file) => `  ${file}`).join('\n')}`);
  }
  return true;
}
