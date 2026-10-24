import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = path.join(root, 'src-tauri', 'binaries', 'node-x86_64-pc-windows-msvc.exe');
const entry = path.join(root, 'backend', 'desktop-runtime', 'src', 'server.js');
if (!fs.existsSync(node) || !fs.existsSync(entry)) {
  throw new Error('Run npm run desktop:prepare before verifying the sidecar.');
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunday-stride-desktop-'));
const child = spawn(node, [entry], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_PATH: path.join(dataDir, 'test.sqlite'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
    TAURI_SIDECAR: '1',
    SERVE_FRONTEND: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
const timeout = setTimeout(() => child.kill(), 15_000);
try {
  const baseUrl = await new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/).find((item) => item.startsWith('SIDECAR_READY:'));
      if (line) resolve(JSON.parse(line.slice('SIDECAR_READY:'.length)).baseUrl);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Sidecar exited (${code}). ${stderr}`)));
  });
  const races = await fetch(`${baseUrl}/api/races`);
  if (!races.ok || !(await races.json()).every((race) => race.id)) {
    throw new Error(`Unexpected health response: ${races.status}`);
  }
  console.log(`Sidecar started at ${baseUrl}; SQLite opened and /api/races responded.`);
} finally {
  clearTimeout(timeout);
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
