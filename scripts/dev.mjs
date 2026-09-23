import path from 'node:path';
import { projectRoot, startBackend, startProcess, stopProcess, supervise } from './backend.mjs';

let backend;
try {
  backend = startBackend({ reload: true });
  const frontend = startProcess('web', process.execPath, [
    path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', ...process.argv.slice(2),
  ], { cwd: projectRoot });
  supervise([backend, frontend]);
} catch (error) {
  stopProcess(backend);
  console.error(error.message);
  process.exitCode = 1;
}
