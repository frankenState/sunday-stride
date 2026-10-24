import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNoBundledDatabases } from './assert-no-bundled-databases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
if (fs.existsSync(cargoBin)) env[pathKey] = `${cargoBin};${env[pathKey] ?? ''}`;

function fail(message) {
  console.error(`\nPackaging preflight failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const windowsBatch = process.platform === 'win32' && /\.cmd$/i.test(command);
  const result = windowsBatch
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], { cwd: root, env, stdio: 'inherit', ...options })
    : spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  return result;
}

function findCommand(command) {
  const whereExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  const where = spawnSync(whereExe, [command], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  return where.status === 0 ? where.stdout.split(/\r?\n/).find(Boolean) : null;
}

function assertCommand(command, args, label) {
  if (!findCommand(command)) fail(`${label} was not found on PATH. Install it or add it to PATH, then rerun the packaging script.`);
  const result = run(command, args);
  if (result.status !== 0) fail(`${label} check failed.`);
}

function getCargoVersion() {
  const text = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  return text.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

function validateVersions() {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const frontend = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'package.json'), 'utf8'));
  const backend = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8'));
  const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const versions = {
    root: rootPackage.version,
    frontend: frontend.version,
    backend: backend.version,
    Tauri: tauri.version,
    Cargo: getCargoVersion(),
  };
  const mismatches = Object.entries(versions).filter(([, version]) => version !== rootPackage.version);
  if (!rootPackage.version || mismatches.length) {
    fail(`Version declarations must all match root package.json (${rootPackage.version ?? 'missing'}). Found: ${Object.entries(versions).map(([name, version]) => `${name}=${version ?? 'missing'}`).join(', ')}.`);
  }
  console.log(`Sunday Stride version ${rootPackage.version}`);
}

function validateVisualStudio() {
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhereCandidates = [
    path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    ...(findCommand('vswhere.exe') ? [findCommand('vswhere.exe')] : []),
  ];
  const vswhere = vswhereCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!vswhere) fail('Visual Studio Installer (vswhere.exe) was not found. Install Visual Studio Build Tools with the C++ build tools workload.');
  const result = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) fail('Visual Studio C++ Build Tools are missing. Install the C++ build tools workload.');
  console.log(`Visual Studio Build Tools: ${result.stdout.trim()}`);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  fail('The current sidecar and NSIS bundle target Windows x64. Run PACKAGE.cmd or PACKAGE.sh from Windows x64; PACKAGE.sh requires Git Bash (not WSL).');
}

validateVersions();
try {
  assertNoBundledDatabases(root);
  console.log('Tauri bundle resources contain no SQLite/database files.');
} catch (error) {
  fail(error.message);
}
assertCommand('node.exe', ['--version'], 'Node.js');
assertCommand('npm.cmd', ['--version'], 'npm');
assertCommand('cargo.exe', ['--version'], 'Rust Cargo');
assertCommand('rustc.exe', ['--version'], 'Rust compiler');
assertCommand('rustup.exe', ['target', 'list', '--installed'], 'Rustup');
validateVisualStudio();

const rustup = findCommand('rustup.exe') ?? path.join(cargoBin, 'rustup.exe');
const targets = spawnSync(rustup, ['target', 'list', '--installed'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
if (targets.status !== 0 || !targets.stdout.split(/\r?\n/).includes('x86_64-pc-windows-msvc')) {
  fail('Rust target x86_64-pc-windows-msvc is not installed. Run rustup target add x86_64-pc-windows-msvc.');
}

if (process.argv.includes('--check')) {
  console.log('\nPackaging prerequisites and version declarations are ready.');
  process.exit(0);
}

console.log('\nBuilding the Windows x64 NSIS installer…');
const build = run('npm.cmd', ['run', 'desktop:build']);
if (build.status !== 0) process.exit(build.status ?? 1);

const bundleDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const installers = fs.existsSync(bundleDir) ? fs.readdirSync(bundleDir).filter((name) => name.endsWith('-setup.exe')) : [];
if (!installers.length) fail(`Build completed but no NSIS setup executable was found in ${bundleDir}.`);
for (const installer of installers) console.log(`\nInstaller ready: ${path.join(bundleDir, installer)}`);
