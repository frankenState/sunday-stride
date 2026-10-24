import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(sourceDir, '..');
export const repositoryRoot = path.resolve(backendRoot, '..');

export function readConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number.isInteger(Number(env.PORT)) ? Number(env.PORT) : 3001,
    databasePath: env.DATABASE_PATH || path.join(backendRoot, 'fun-run.sqlite'),
    backupDir: env.BACKUP_DIR || path.join(backendRoot, 'backups'),
    frontendDist: env.FRONTEND_DIST || path.join(repositoryRoot, 'frontend', 'dist'),
    serveFrontend: env.SERVE_FRONTEND === '1',
    sidecar: env.TAURI_SIDECAR === '1',
    cleanStartToken: env.CLEAN_START_TOKEN || undefined,
    publicFrontendDist: env.PUBLIC_FRONTEND_DIST || '',
    lanSharing: env.LAN_SHARING === '1',
  };
}
