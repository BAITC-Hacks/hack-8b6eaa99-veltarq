import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const backendRoot = path.join(projectRoot, 'backend');
const windows = process.platform === 'win32';
const venvPython = path.join(backendRoot, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
let selectedPython;

function candidates(requireDependencies) {
  return [
    requireDependencies && { command: venvPython, args: [] },
    process.env.PYTHON && { command: process.env.PYTHON, args: [] },
    !requireDependencies && { command: venvPython, args: [] },
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
    windows && { command: 'py', args: ['-3'] },
    windows && {
      command: path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),
      args: [],
    },
  ].filter(Boolean);
}

export function resolvePython({ requireDependencies = true } = {}) {
  const code = [
    'import sys',
    'assert sys.version_info >= (3, 11)',
    ...(requireDependencies ? ['import fastapi, uvicorn, httpx, dotenv'] : []),
  ].join('; ');
  for (const python of candidates(requireDependencies)) {
    const result = spawnSync(python.command, [...python.args, '-c', code], {
      cwd: backendRoot,
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10000,
    });
    if (result.status === 0) { selectedPython = python; return python; }
    // Outside the project venv, report a broken explicit interpreter rather than guessing.
    if (process.env.PYTHON && python.command === process.env.PYTHON) {
      throw new Error(`PYTHON=${process.env.PYTHON} needs Python 3.11+${requireDependencies ? ' and backend dependencies' : ''}. Run npm run setup:backend.`);
    }
  }
  throw new Error(requireDependencies
    ? 'Backend dependencies are missing. Install Python 3.11+ and run npm run setup:backend.'
    : 'Python 3.11+ was not found. Install Python or set PYTHON to its executable path.');
}

export function startProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: backendRoot,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
    detached: !windows,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) output.write(`[${label}] ${line}\n`);
    });
    stream.on('end', () => { if (pending) output.write(`[${label}] ${pending}\n`); });
  }
  return child;
}

export function startBackend({ reload = false, serveFrontend = false } = {}) {
  const python = resolvePython();
  const args = [
    ...python.args, '-m', 'uvicorn', 'app.main:app',
    '--host', process.env.BACKEND_HOST || '127.0.0.1',
    '--port', process.env.BACKEND_PORT || '8000',
  ];
  const envFile = path.join(backendRoot, '.env');
  if (existsSync(envFile)) args.push('--env-file', envFile);
  if (reload) args.push('--reload', '--reload-dir', path.join(backendRoot, 'app'));
  return startProcess('backend', python.command, args, {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      ...(serveFrontend ? { VELTARQ_SERVE_FRONTEND: 'true' } : {}),
    },
  });
}

export function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (windows) {
    try {
      const python = selectedPython || resolvePython({ requireDependencies: false });
      spawnSync(python.command, [
        ...python.args, path.join(projectRoot, 'scripts/stop-process-tree.py'), String(child.pid),
      ], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    } finally {
      // Also close the direct child if enumeration is unavailable on a locked-down host.
      try { child.kill(); } catch { /* already stopped */ }
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}

export function supervise(children) {
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) stopProcess(child);
    process.exitCode = code;
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  process.on('exit', () => { for (const child of children) stopProcess(child); });
  for (const child of children) {
    child.on('error', (error) => { console.error(error.message); stop(1); });
    child.on('exit', (code, signal) => { if (!stopping) stop(code ?? (signal ? 1 : 0)); });
  }
}

function runPython(python, args) {
  return new Promise((resolve, reject) => {
    const child = startProcess('backend', python.command, [...python.args, ...args]);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Python command exited with ${code}.`)));
  });
}

async function main() {
  if (process.argv.includes('--install')) {
    const basePython = resolvePython({ requireDependencies: false });
    if (!existsSync(venvPython)) await runPython(basePython, ['-m', 'venv', '.venv']);
    await runPython({ command: venvPython, args: [] }, ['-m', 'pip', 'install', '-e', '.[dev]']);
    console.log('Backend installed. Run npm run dev.');
  } else if (process.argv.includes('--check-llm')) {
    await runPython(resolvePython(), ['scripts/check_llm.py']);
  } else if (process.argv.includes('--test')) {
    await runPython(resolvePython(), ['-m', 'pytest', ...process.argv.slice(2).filter((arg) => arg !== '--test')]);
  } else {
    supervise([startBackend({
      reload: process.argv.includes('--reload'),
      serveFrontend: process.argv.includes('--serve'),
    })]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
