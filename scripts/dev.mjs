import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDist = path.join(root, 'frontend', 'dist');
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function assertPortAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      const detail = error.code === 'EADDRINUSE' ? 'is already in use' : `cannot be reserved (${error.message})`;
      reject(new Error(`Development ${host}:${port} ${detail}. Stop the existing app/dev server and run npm run dev again.`));
    });
    server.listen(port, host, () => server.close((error) => error ? reject(error) : resolve()));
  });
}

function buildViewer() {
  const windows = process.platform === 'win32';
  const command = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = windows
    ? ['/d', '/s', '/c', 'npm.cmd run build --workspace frontend']
    : ['run', 'build', '--workspace', 'frontend'];
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
    throw new Error('The frontend build did not produce frontend/dist/index.html.');
  }
}

try {
  await Promise.all([assertPortAvailable(3001, '127.0.0.1'), assertPortAvailable(5173, '127.0.0.1')]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
buildViewer();
console.log('LAN leaderboard viewer built. Frontend edits to the public viewer require restarting npm run dev.');

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null && !child.killed) child.kill();
  process.exitCode = code;
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

function start(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.once('error', (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.once('close', (code, signal) => {
    if (!stopping) {
      console.error(`${name} stopped${signal ? ` after ${signal}` : ` with exit code ${code}`}.`);
      stop(code ?? 1);
    }
  });
}

start('API server', ['--watch', 'src/server.js'], path.join(root, 'backend'), {
  ...process.env,
  HOST: '127.0.0.1',
  LAN_SHARING: '1',
  PUBLIC_FRONTEND_DIST: frontendDist,
});
start('Vite', [viteEntry, '--host', '0.0.0.0', '--port', '5173', '--strictPort'], path.join(root, 'frontend'), process.env);
