import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectRoot, startBackend, startProcess, stopProcess } from './backend.mjs';

// An isolated loopback port avoids interrupting an already-running development server.
const listener = net.createServer();
await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
process.env.BACKEND_HOST = '127.0.0.1';
process.env.BACKEND_PORT = String(port);
// Contract checks are deterministic and never require a paid model call.
process.env.VELTARQ_LLM_BASE_URL = '';
process.env.VELTARQ_LLM_MODEL = '';
const backend = startBackend();
let runner;
process.on('exit', () => { stopProcess(runner); stopProcess(backend); });
process.on('SIGINT', () => { stopProcess(runner); stopProcess(backend); process.exitCode = 130; });
backend.on('error', (error) => { console.error(error.message); });
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (backend.exitCode !== null) throw new Error('Backend exited before becoming ready.');
    try { ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* still starting */ }
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error('Backend did not become ready in 15 seconds.');
  runner = startProcess('contract', process.execPath, [
    path.join(projectRoot, 'node_modules/vitest/vitest.mjs'), 'run', 'src/api.integration.test.ts',
  ], { cwd: projectRoot, env: { ...process.env, VITE_TEST_API_URL: `${origin}/api/v1` } });
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stopProcess(runner);
  stopProcess(backend);
}
