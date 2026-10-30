import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UpdateService, updateError, type UpdateEngine } from '../src/main/updates';
import type { UpdateState } from '../src/shared/types';

const parent = fileURLToPath(new URL('../../../work/update-tests', import.meta.url));
const roots: string[] = [];
const services: UpdateService[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(engine: Partial<UpdateEngine> = {}, options: { canInstall?: () => boolean; mode?: UpdateState['mode']; checkTimeoutMs?: number; downloadTimeoutMs?: number } = {}) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'harborgit-update-')); roots.push(root);
  const events: UpdateState[] = [];
  const driver: UpdateEngine = { check: async () => ({ version: '1.3.1', notes: 'fixture release' }), download: async () => {}, install: () => {}, ...engine };
  const settingsFile = path.join(root, '中文 profile', 'update-settings.json');
  const service = new UpdateService({ currentVersion: '1.3.0', mode: 'installer', engine: driver, settingsFile, canInstall: () => true, onState: state => events.push(state), ...options });
  services.push(service); return { service, driver, events, settingsFile };
}
test.after(async () => {
  for (const service of services) service.dispose();
  for (const root of roots) {
    assert.ok(path.resolve(root).startsWith(parent + path.sep) && path.basename(root).startsWith('harborgit-update-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('check exposes a newer release without downloading or installing; latest clears previous release', async () => {
  let downloads = 0, installs = 0;
  const { service, driver, events } = await fixture({ download: async () => { downloads++; }, install: () => { installs++; } });
  assert.equal((await service.check()).phase, 'available');
  assert.equal(service.snapshot.release?.version, '1.3.1');
  assert.ok(service.snapshot.checkedAt);
  assert.equal(downloads, 0); assert.equal(installs, 0);
  assert.deepEqual(events.map(s => s.phase), ['checking', 'available']);
  driver.check = async () => null;
  assert.equal((await service.check()).phase, 'idle'); assert.equal(service.snapshot.release, undefined);
});

test('duplicate checks are rejected; check timeout cannot be overwritten by a late response', async () => {
  const pending = deferred<{ version: string }>();
  const { service } = await fixture({ check: () => pending.promise }, { checkTimeoutMs: 15 });
  const checking = service.check();
  await assert.rejects(service.check(), /正在进行/);
  assert.equal((await checking).phase, 'error'); assert.match(service.snapshot.error!, /超时/);
  pending.resolve({ version: '9.0.0' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.snapshot.phase, 'error'); assert.equal(service.snapshot.release, undefined);
});

test('download progress, cancellation, retry and explicit installation', async () => {
  let installs = 0, attempts = 0;
  const { service, events } = await fixture({
    install: () => { installs++; },
    download: async (signal, report) => {
      attempts++; report({ percent: 150, transferred: 4096, total: 8192, bytesPerSecond: 2048 });
      if (attempts === 1) await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    },
  });
  await service.check();
  const download = service.download();
  assert.equal(service.snapshot.progress?.percent, 100);
  await assert.rejects(service.check(), /正在进行/);
  await assert.rejects(service.download(), /正在进行/);
  assert.throws(() => service.install(), /先下载/);
  service.cancel(); await download;
  assert.equal(service.snapshot.phase, 'available'); assert.match(service.snapshot.message, /取消/);
  await service.download(); assert.equal(service.snapshot.phase, 'downloaded');
  assert.equal(installs, 0); // No automatic installation on download or normal quit.
  await assert.rejects(service.check(), /已下载/);
  service.install(); assert.equal(service.isInstalling, true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(installs, 1);
  assert.throws(() => service.install(), /先下载/);
  assert.ok(events.some(state => state.phase === 'downloading' && state.progress));
});

test('download checksum failure cannot install and permits retry', async () => {
  let fail = true;
  const { service } = await fixture({ download: async () => { if (fail) throw new Error('sha512 checksum mismatch'); } });
  await service.check(); await service.download();
  assert.equal(service.snapshot.phase, 'error'); assert.match(service.snapshot.error!, /校验失败/);
  assert.throws(() => service.install(), /先下载/);
  fail = false; await service.download(); assert.equal(service.snapshot.phase, 'downloaded');
});

test('download timeout aborts the actual engine and remains retryable', async () => {
  let aborted = false;
  const { service } = await fixture({ download: signal => new Promise<never>((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true })) }, { downloadTimeoutMs: 15 });
  await service.check(); await service.download();
  assert.equal(aborted, true); assert.equal(service.snapshot.phase, 'error'); assert.match(service.snapshot.error!, /超时/);
});

test('running Git or AI work prevents installation and a launcher failure permits another attempt', async () => {
  let busy = true;
  const { service } = await fixture({ install: () => { throw new Error('launch failure'); } }, { canInstall: () => !busy });
  await service.check(); await service.download();
  assert.throws(() => service.install(), /任务运行/); assert.equal(service.snapshot.phase, 'downloaded');
  busy = false; service.install(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.snapshot.phase, 'downloaded'); assert.ok(service.snapshot.error);
});

test('auto-check preference survives restart; snapshots are isolated and invalid values rejected', async () => {
  const { service, settingsFile } = await fixture();
  await service.saveAutoCheck(false);
  assert.equal(JSON.parse(await readFile(settingsFile, 'utf8')).autoCheck, false);
  const next = new UpdateService({ currentVersion: '1.3.0', mode: 'manual', settingsFile, canInstall: () => true }); services.push(next);
  assert.equal((await next.load()).autoCheck, false);
  const snapshot = next.snapshot; snapshot.autoCheck = true;
  assert.equal(next.snapshot.autoCheck, false);
  await assert.rejects(next.saveAutoCheck('true' as unknown as boolean), /设置无效/);
});

test('development and manual packages never check, download or install automatically', async () => {
  for (const mode of ['development', 'manual'] as const) {
    let called = false;
    const { service } = await fixture({ check: async () => { called = true; return null; } }, { mode });
    service.schedule(); await assert.rejects(service.check()); await assert.rejects(service.download()); assert.throws(() => service.install());
    assert.equal(called, false); assert.equal(service.snapshot.phase, 'idle');
  }
});

test('public feed errors are actionable without exposing raw response bodies', () => {
  assert.match(updateError(new Error('404 token=not-for-ui')), /latest.yml/);
  assert.match(updateError({ code: 'ENOTFOUND' }), /无法连接/);
  assert.match(updateError(new Error('sha512 checksum mismatch')), /校验失败/);
  assert.doesNotMatch(updateError(new Error('private raw response')), /private raw/);
});
