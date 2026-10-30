import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('..', import.meta.url));
const parent = path.resolve(project, '../../work/update-runtime');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'harborgit-update-'));
const entry = path.join(root, 'runtime.cjs');
try {
  await build({ entryPoints: [path.join(project, 'tests/update-runtime.ts')], outfile: entry, platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'] });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const require = createRequire(import.meta.url);
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [entry, root, project], { cwd: project, env, shell: false, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Update runtime verification failed (${code})`)));
  });
} finally {
  assert.ok(path.resolve(root).startsWith(parent + path.sep) && path.basename(root).startsWith('harborgit-update-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
