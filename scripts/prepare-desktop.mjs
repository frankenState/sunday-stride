import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNoBundledDatabases } from './assert-no-bundled-databases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows desktop package currently targets win32 x64. Run this script on a Windows x64 build machine.');
}

const backendSource = path.join(root, 'backend', 'src');
const runtimeRoot = path.join(root, 'backend', 'desktop-runtime');
const runtimeSource = path.join(runtimeRoot, 'src');
const runtimeModules = path.join(runtimeRoot, 'node_modules');
const sidecarDir = path.join(root, 'src-tauri', 'binaries');
const sidecarPath = path.join(sidecarDir, 'node-x86_64-pc-windows-msvc.exe');

fs.rmSync(runtimeSource, { recursive: true, force: true });
fs.cpSync(backendSource, runtimeSource, { recursive: true });
fs.mkdirSync(sidecarDir, { recursive: true });
fs.copyFileSync(process.execPath, sidecarPath);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'];
const install = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [npm, ...npmArgs].join(' ')], { cwd: runtimeRoot, stdio: 'inherit' })
  : spawnSync(npm, npmArgs, { cwd: runtimeRoot, stdio: 'inherit' });
if (install.status !== 0) throw new Error('Could not install the locked backend runtime dependencies.');

const nativeBinding = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(nativeBinding)) throw new Error('The better-sqlite3 native binding is missing. Install the backend dependencies before packaging.');
const bindingTarget = path.join(runtimeModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
fs.mkdirSync(path.dirname(bindingTarget), { recursive: true });
fs.copyFileSync(nativeBinding, bindingTarget);
assertNoBundledDatabases(root);
console.log(`Prepared Windows x64 Node sidecar at ${sidecarPath}`);
