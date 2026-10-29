import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const project = fileURLToPath(new URL('..', import.meta.url));
const parent = path.resolve(project, '../../work/portable-smoke');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'harborgit-portable-'));
const packageInfo = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const executable = path.join(project, `release/HarborGit-${packageInfo.version}-Windows-x64.exe`);
const env = { ...process.env, HARBOR_USER_DATA: path.join(root, 'profile'), HARBOR_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let browser, child;
try {
  // NSIS portable is a launcher, not Electron itself: attach to the extracted
  // Chromium process rather than asking Playwright to instrument the launcher.
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  child = spawn(executable, [`--remote-debugging-port=${port}`], { env, shell: false, windowsHide: true, stdio: 'ignore' });
  let error = null; child.on('error', e => { error = e; });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (error) throw error;
    try { if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Extracting / starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Portable launcher did not expose its own Chromium endpoint');
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole('button', { name: '打开本地仓库', exact: true }).waitFor({ state: 'visible' });
  const version = await page.evaluate(() => window.harbor.version());
  assert.equal(version, packageInfo.version);
  const renderer = await page.evaluate(() => ({ title: document.title, node: typeof window.require, bridge: typeof window.harbor.request }));
  assert.equal(renderer.title, 'HarborGit'); assert.equal(renderer.node, 'undefined'); assert.equal(renderer.bridge, 'function');
  const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
  const result = { status: 'passed', time: new Date().toISOString(), executable, sha256, version, renderer, note: 'Launched the self-extracting portable EXE and attached to the extracted app over loopback CDP with a dedicated empty profile; no repository was opened or modified.' };
  await writeFile(path.join(project, 'docs/verification-v1.2-portable.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    await page?.evaluate(() => window.close()).catch(() => {});
    await browser.close();
  }
  if (child && child.exitCode === null && child.pid) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) await new Promise(resolve => { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' }); killer.on('close', resolve); killer.on('error', resolve); });
  }
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(parent + path.sep) && path.basename(resolved).startsWith('harborgit-portable-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
