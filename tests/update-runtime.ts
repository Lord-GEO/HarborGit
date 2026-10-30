// Real electron-updater + Electron networking. This harness is never shipped in
// the app; its local feed contains inert bytes and it never executes an installer.
import { app } from 'electron';
import { NsisUpdater } from 'electron-updater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';
import { createUpdateEngine } from '../src/main/update-engine';
import { UpdateService } from '../src/main/updates';
import type { UpdateState } from '../src/shared/types';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [root, project] = process.argv.slice(2);
assert.ok(root && project && path.resolve(root).startsWith(path.resolve(project, '../../work/update-runtime') + path.sep));
app.setPath('userData', path.join(root, 'electron-profile')); app.disableHardwareAcceleration();
const payload = Buffer.alloc(3 * 1024 * 1024, 0x48);
const sha512 = createHash('sha512').update(payload).digest('base64');
let mode: 'normal' | 'bad' | 'slow' | 'latest' | 'missing' = 'normal';
const requests: string[] = [], checks: string[] = [], services: UpdateService[] = [];
const server = createServer((request, response) => {
  requests.push(request.url || '');
  if (request.url?.startsWith('/latest.yml')) {
    if (mode === 'missing') { response.writeHead(404).end('no manifest'); return; }
    response.setHeader('Content-Type', 'application/yaml');
    response.end(JSON.stringify({ version: mode === 'latest' ? '1.3.0' : '1.3.1', files: [{ url: 'HarborGit-Fixture-Setup.exe', sha512, size: payload.length }], path: 'HarborGit-Fixture-Setup.exe', sha512, releaseDate: '2026-10-30T00:00:00Z', releaseNotes: 'Local update fixture; never executed.' })); return;
  }
  if (request.url?.startsWith('/HarborGit-Fixture-Setup.exe')) {
    response.setHeader('Content-Type', 'application/octet-stream'); response.setHeader('Content-Length', payload.length);
    if (mode === 'bad') { const bad = Buffer.from(payload); bad[0] ^= 0xff; response.end(bad); return; }
    if (mode !== 'slow') { response.end(payload); return; }
    let offset = 0;
    const timer = setInterval(() => { const end = Math.min(offset + 64 * 1024, payload.length); response.write(payload.subarray(offset, end)); offset = end; if (offset === payload.length) { clearInterval(timer); response.end(); } }, 40);
    response.once('close', () => clearInterval(timer)); return;
  }
  response.writeHead(404).end();
});
async function waitFor(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function fixture(name: string) {
  const folder = path.join(root, name); await mkdir(folder, { recursive: true });
  const config = path.join(folder, 'app-update.yml');
  await writeFile(config, JSON.stringify({ provider: 'generic', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, updaterCacheDirName: `fixture-${name}` }));
  const adapter = { version: '1.3.0', name: 'HarborGit Update Fixture', isPackaged: true, appUpdateConfigPath: config, userDataPath: folder, baseCachePath: path.join(folder, 'cache'), whenReady: async () => {}, relaunch: () => { throw new Error('No relaunch in fixture'); }, quit: () => { throw new Error('No quit/install in fixture'); }, onQuit: () => {} };
  const updater = new NsisUpdater(null, adapter);
  (updater as unknown as { httpExecutor: ElectronHttpExecutor }).httpExecutor = new ElectronHttpExecutor();
  updater.disableDifferentialDownload = true; updater.logger = null;
  const engine = createUpdateEngine(error => service.installFailed(error), updater);
  const events: UpdateState[] = [];
  const service = new UpdateService({ currentVersion: '1.3.0', mode: 'installer', engine, settingsFile: path.join(folder, 'settings.json'), canInstall: () => false, onState: state => events.push(state) });
  services.push(service); return { service, updater, events };
}
async function run() {
  await app.whenReady();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const first = await fixture('normal');
  await first.service.check(); assert.equal(first.service.snapshot.phase, 'available');
  assert.equal(requests.filter(url => url.includes('.exe')).length, 0);
  assert.equal(first.updater.autoDownload, false); assert.equal(first.updater.autoInstallOnAppQuit, false);
  checks.push('Real NSIS updater reads local metadata; checking does not download or auto-install');
  await first.service.download(); assert.equal(first.service.snapshot.phase, 'downloaded');
  const installerPath = (first.updater as unknown as { installerPath: string | null }).installerPath;
  assert.ok(installerPath?.startsWith(root + path.sep));
  assert.equal(createHash('sha512').update(await readFile(installerPath!)).digest('base64'), sha512);
  assert.ok(first.events.some(event => event.progress)); assert.throws(() => first.service.install(), /任务运行/);
  checks.push('Real download caches only in the dedicated test directory, validates SHA-512 and reports progress');
  mode = 'bad'; const bad = await fixture('bad'); await bad.service.check(); await bad.service.download();
  assert.equal(bad.service.snapshot.phase, 'error'); assert.match(bad.service.snapshot.error!, /校验失败/);
  assert.throws(() => bad.service.install(), /先下载/); checks.push('Corrupted payload rejected by actual electron-updater SHA-512 validation');
  mode = 'slow'; const slow = await fixture('slow'); await slow.service.check();
  const count = requests.filter(url => url.includes('.exe')).length;
  const downloading = slow.service.download();
  await waitFor(() => requests.filter(url => url.includes('.exe')).length > count);
  slow.service.cancel(); await downloading;
  assert.equal(slow.service.snapshot.phase, 'available');
  mode = 'normal'; await slow.service.download(); assert.equal(slow.service.snapshot.phase, 'downloaded');
  checks.push('Actual HTTP download cancellation followed by a successful retry');
  mode = 'latest'; const latest = await fixture('latest'); await latest.service.check();
  assert.equal(latest.service.snapshot.phase, 'idle'); checks.push('Equal version correctly reports no available update');
  mode = 'missing'; const missing = await fixture('missing'); await missing.service.check();
  assert.equal(missing.service.snapshot.phase, 'error'); assert.match(missing.service.snapshot.error!, /latest.yml/);
  checks.push('Missing update manifest displays an actionable release publishing error');
  await writeFile(path.join(project, 'docs/verification-v1.3-update-runtime.json'), JSON.stringify({ status: 'passed', checks, payload: 'Inert 3 MiB fixture bytes, never executed', feed: 'Loopback HTTP only', installed: false, requests }, null, 2));
  console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
}
run().then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code: number) { for (const service of services) service.dispose(); server.closeAllConnections(); server.close(() => app.exit(code)); }
