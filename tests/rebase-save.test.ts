import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService, GitError } from '../src/main/git-service';
import type { Activity, Repository } from '../src/shared/types';
const base = fileURLToPath(new URL('../../../work/rebase-save', import.meta.url));
const roots: string[] = [];
function gitRaw(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '.git/fixture-global'), GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr?.toString() || 'Git fixture failed'); return result.stdout;
}
const git = (cwd: string, args: string[]) => gitRaw(cwd, args).toString('utf8').trim();
async function commit(repo: string, file: string, content: string | Buffer, subject: string) {
  await writeFile(path.join(repo, file), content); git(repo, ['add', '--', file]); git(repo, ['commit', '-m', subject]); return git(repo, ['rev-parse', 'HEAD']);
}
async function fixture(conflict = false) {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-wip-')); roots.push(root);
  const repo = path.join(root, '仓库 中文 space'); await mkdir(repo); git(repo, ['init', '--initial-branch=master']);
  for (const [key, value] of [['user.name', 'Saved WIP Test'], ['user.email', 'wip@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(repo, ['config', key, value]);
  await commit(repo, 'dirty.txt', 'base\n', 'base'); await commit(repo, 'shared.txt', 'base\n', 'shared base');
  const masterBase = await commit(repo, 'data.bin', Buffer.from([0, 1, 2, 3]), 'binary base');
  git(repo, ['switch', '-c', 'dev']); const devHead = await commit(repo, conflict ? 'shared.txt' : 'dev.txt', conflict ? 'dev\n' : 'dev feature\n', 'dev feature');
  git(repo, ['switch', 'master']); const masterHead = await commit(repo, conflict ? 'shared.txt' : 'master.txt', conflict ? 'master\n' : 'master feature\n', 'master feature');
  git(repo, ['switch', 'dev']); return { root, repo, masterBase, masterHead, devHead };
}
async function wip(repo: string) {
  await writeFile(path.join(repo, 'dirty.txt'), 'STAGED\n'); git(repo, ['add', '--', 'dirty.txt']); await writeFile(path.join(repo, 'dirty.txt'), 'UNSTAGED_PRIVATE\n');
  await writeFile(path.join(repo, 'data.bin'), Buffer.from([0, 9, 2, 3])); git(repo, ['add', '--', 'data.bin']); await writeFile(path.join(repo, 'data.bin'), Buffer.from([0, 9, 8, 3]));
  await writeFile(path.join(repo, '未跟踪 [1].bin'), Buffer.from([0, 255, 7, 9]));
  return { tree: git(repo, ['write-tree']), status: git(repo, ['status', '--porcelain=v2', '-z']) };
}
async function assertWip(repo: string) {
  assert.equal(await readFile(path.join(repo, 'dirty.txt'), 'utf8'), 'UNSTAGED_PRIVATE\n'); assert.equal(git(repo, ['show', ':dirty.txt']), 'STAGED');
  assert.deepEqual(await readFile(path.join(repo, 'data.bin')), Buffer.from([0, 9, 8, 3])); assert.deepEqual(gitRaw(repo, ['show', ':data.bin']), Buffer.from([0, 9, 2, 3]));
  assert.deepEqual(await readFile(path.join(repo, '未跟踪 [1].bin')), Buffer.from([0, 255, 7, 9]));
}
async function open(repo: string, onActivity?: (event: Activity) => void) { const service = new GitService({ onActivity }); const state = await service.request('open', { path: repo }); return { service, state }; }
function savedRef(repo: string, state: Repository, original: string) {
  const ref = state.rebaseSavedChanges?.ref; assert.match(ref || '', /^refs\/harborgit\/wip\//);
  assert.equal(git(repo, ['rev-parse', `${ref}^1`]), original); return ref!;
}
test.after(async () => {
  for (const root of roots) { assert.ok(path.resolve(root).startsWith(base + path.sep) && path.basename(root).startsWith('harborgit-wip-')); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
});

test('saved changes rebase: staged, unstaged, Unicode untracked and binary content restore without touching existing stash', async () => {
  const { repo, devHead, masterHead } = await fixture();
  await writeFile(path.join(repo, 'older-private.txt'), 'user stash\n'); git(repo, ['stash', 'push', '--include-untracked', '-m', 'existing user stash']); const older = git(repo, ['rev-parse', 'refs/stash']);
  await wip(repo); await writeFile(path.join(repo, '.git/info/exclude'), 'node_modules/\n'); await mkdir(path.join(repo, 'node_modules')); await writeFile(path.join(repo, 'node_modules/private.txt'), 'ignored\n');
  const { service } = await open(repo); const result = await service.request('rebase', { branch: 'master', expectedHead: devHead, autoSaveChanges: true });
  assert.equal(result.branch, 'dev'); assert.equal(result.operation, undefined); assert.equal(result.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['rev-parse', 'HEAD^']), masterHead); await assertWip(repo); savedRef(repo, result, devHead);
  assert.ok(git(repo, ['stash', 'list', '--format=%H']).split('\n').includes(older)); assert.equal(await readFile(path.join(repo, 'node_modules/private.txt'), 'utf8'), 'ignored\n');
});

test('saved changes rebase: another source branch changes while original dev WIP and index return exactly', async () => {
  const { repo, masterBase, devHead } = await fixture(); const before = await wip(repo); const { service } = await open(repo);
  const masterTip = git(repo, ['rev-parse', 'master']);
  const result = await service.request('rebase', { targetCommit: devHead, sourceBranch: 'master', expectedSourceHead: masterTip, expectedHead: devHead, autoSaveChanges: true });
  assert.equal(result.branch, 'dev'); assert.equal(result.head, devHead); assert.equal(result.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['rev-parse', 'dev']), devHead); assert.equal(git(repo, ['rev-parse', 'master^']), devHead);
  assert.equal(git(repo, ['write-tree']), before.tree); await assertWip(repo); savedRef(repo, result, devHead);
  assert.equal(git(repo, ['rev-parse', result.historyBackup!]), masterTip); assert.notEqual(masterTip, masterBase);
});

test('saved changes rebase: suspended operation survives reopen and abort restores every original change', async () => {
  const { repo, devHead } = await fixture(true); const before = await wip(repo); const { service } = await open(repo);
  const stopped = await service.request('rebase', { branch: 'master', expectedHead: devHead, autoSaveChanges: true });
  assert.equal(stopped.operation?.kind, 'rebase'); assert.equal(stopped.rebaseSavedChanges?.status, 'saved'); const ref = savedRef(repo, stopped, devHead);
  const next = await open(repo); assert.equal(next.state.rebaseSavedChanges?.ref, ref);
  const result = await next.service.request('rebaseAction', { action: 'abort' });
  assert.equal(result.head, devHead); assert.equal(result.branch, 'dev'); assert.equal(result.operation, undefined); assert.equal(result.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['write-tree']), before.tree); await assertWip(repo);
});

test('saved changes rebase: conflict resolution and continue restore saved WIP after the rewritten commit', async () => {
  const { repo, devHead, masterHead } = await fixture(true); await wip(repo); const { service } = await open(repo);
  await service.request('rebase', { branch: 'master', expectedHead: devHead, autoSaveChanges: true });
  await service.request('resolve', { path: 'shared.txt', choice: 'manual', content: 'master and dev\n' });
  const result = await service.request('rebaseAction', { action: 'continue' });
  assert.equal(result.operation, undefined); assert.equal(result.rebaseSavedChanges?.status, 'restored'); assert.equal(git(repo, ['rev-parse', 'HEAD^']), masterHead);
  assert.equal(git(repo, ['show', 'HEAD:shared.txt']), 'master and dev'); await assertWip(repo);
});

test('saved changes rebase: restoration conflict retains saved bytes, blocks duplicate apply and supports manual completion', async () => {
  const { repo, devHead } = await fixture(); git(repo, ['switch', 'master']); const target = await commit(repo, 'dirty.txt', 'UPSTREAM\n', 'upstream dirty change'); git(repo, ['switch', 'dev']);
  await writeFile(path.join(repo, 'dirty.txt'), 'PRIVATE_WIP\n'); const { service } = await open(repo);
  const result = await service.request('rebase', { targetCommit: target, expectedHead: devHead, autoSaveChanges: true });
  assert.equal(result.operation, undefined); assert.equal(result.rebaseSavedChanges?.status, 'restore-conflicts'); assert.ok(result.entries.some(file => file.conflict));
  const ref = savedRef(repo, result, devHead); assert.equal(git(repo, ['show', `${ref}:dirty.txt`]), 'PRIVATE_WIP');
  const next = await open(repo); assert.equal(next.state.rebaseSavedChanges?.ref, ref);
  const beforeRetry = git(repo, ['status', '--porcelain=v2', '-z']); const contentsBeforeRetry = await readFile(path.join(repo, 'dirty.txt'));
  const retry = await next.service.request('rebaseSavedAction', { action: 'restore' });
  assert.equal(retry.rebaseSavedChanges?.status, 'restore-conflicts'); assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), beforeRetry); assert.deepEqual(await readFile(path.join(repo, 'dirty.txt')), contentsBeforeRetry);
  await next.service.request('resolve', { path: 'dirty.txt', choice: 'manual', content: 'UPSTREAM and PRIVATE_WIP\n' }); const head = git(repo, ['rev-parse', 'HEAD']);
  const complete = await next.service.request('rebaseSavedAction', { action: 'finish' });
  assert.equal(complete.rebaseSavedChanges?.status, 'restored'); assert.equal(git(repo, ['rev-parse', 'HEAD']), head);
  assert.equal(git(repo, ['show', 'HEAD:dirty.txt']), 'UPSTREAM'); assert.equal(await readFile(path.join(repo, 'dirty.txt'), 'utf8'), 'UPSTREAM and PRIVATE_WIP\n');
});

test('saved changes rebase: untracked restoration collision never overwrites the new committed file', async () => {
  const { repo, devHead } = await fixture(); git(repo, ['switch', 'master']); const target = await commit(repo, 'collision.txt', 'UPSTREAM_FILE\n', 'upstream adds file'); git(repo, ['switch', 'dev']);
  await writeFile(path.join(repo, 'collision.txt'), 'PRIVATE_UNTRACKED\n'); const { service } = await open(repo);
  const result = await service.request('rebase', { targetCommit: target, expectedHead: devHead, autoSaveChanges: true });
  assert.equal(result.operation, undefined); assert.notEqual(result.rebaseSavedChanges?.status, 'restored');
  const ref = savedRef(repo, result, devHead); assert.equal(git(repo, ['show', `${ref}^3:collision.txt`]), 'PRIVATE_UNTRACKED');
  assert.equal(await readFile(path.join(repo, 'collision.txt'), 'utf8'), 'UPSTREAM_FILE\n');
});

test('saved changes rebase: explicit consent and valid snapshots are required before saving', async () => {
  const { repo, devHead } = await fixture(); await wip(repo); const before = git(repo, ['status', '--porcelain=v2', '-z']); const { service } = await open(repo);
  await assert.rejects(service.request('rebase', { branch: 'master', expectedHead: devHead }));
  await assert.rejects(service.request('rebase', { branch: 'master', expectedHead: '0'.repeat(40), autoSaveChanges: true }));
  assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), before); assert.equal(git(repo, ['rev-parse', 'HEAD']), devHead); await assertWip(repo);
});

test('saved changes rebase: cancellation after saving is recoverable from a new service instance', async () => {
  const { repo, devHead } = await fixture(); await wip(repo);
  await writeFile(path.join(repo, '.git/hooks/pre-rebase'), '#!/bin/sh\nprintf ready > .git/wip-hook-ready\nsleep 30\n', { mode: 0o755 });
  let id = ''; const { service } = await open(repo, event => { if (event.kind === 'start' && / rebase /.test(event.command)) id = event.id; });
  const running = service.request('rebase', { branch: 'master', expectedHead: devHead, autoSaveChanges: true });
  const outcome = running.then(value => ({ value }), error => ({ error }));
  const deadline = Date.now() + 10000; let ready = false;
  while (Date.now() < deadline && !ready) { ready = await readFile(path.join(repo, '.git/wip-hook-ready')).then(() => true, () => false); if (!ready) await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(ready && id, 'Dedicated pre-rebase hook was not reached after saving'); assert.equal(service.cancel(id), true); const result = await outcome;
  assert.ok('error' in result && result.error instanceof GitError && result.error.details.cancelled);
  const next = await open(repo); savedRef(repo, next.state, devHead);
  const restored = next.state.operation ? await next.service.request('rebaseAction', { action: 'abort' }) : await next.service.request('rebaseSavedAction', { action: 'restore' });
  assert.equal(restored.rebaseSavedChanges?.status, 'restored'); await assertWip(repo);
});

test('saved changes rebase: interrupted save intent finds its exact stash without applying on reopen', async () => {
  const { repo, devHead } = await fixture(); await wip(repo); const token = randomUUID(), ref = `refs/harborgit/wip/${token}`;
  // Simulate process interruption between stash creation and binding the owned ref.
  await writeFile(path.join(repo, '.git/harborgit-rebase-save.json'), JSON.stringify({ version: 1, token, ref, originalBranch: 'dev', originalHead: devHead, sourceBranch: 'dev', sourceHead: devHead, status: 'saving', message: 'interrupted fixture' }));
  git(repo, ['stash', 'push', '-u', '-m', `HarborGit rebase autosave ${token}`]);
  const { service, state } = await open(repo); assert.equal(state.rebaseSavedChanges?.status, 'restore-pending');
  assert.equal(git(repo, ['status', '--porcelain']), ''); savedRef(repo, state, devHead);
  const restored = await service.request('rebaseSavedAction', { action: 'restore' }); assert.equal(restored.rebaseSavedChanges?.status, 'restored'); await assertWip(repo);
});

test('saved changes rebase: externally changed original branch prevents cross-branch restoration', async () => {
  const { repo, devHead, masterHead, masterBase } = await fixture(true); await wip(repo); const { service } = await open(repo);
  const paused = await service.request('rebase', { targetCommit: devHead, sourceBranch: 'master', expectedSourceHead: masterHead, expectedHead: devHead, autoSaveChanges: true });
  assert.equal(paused.operation?.kind, 'rebase'); const ref = savedRef(repo, paused, devHead);
  git(repo, ['update-ref', 'refs/heads/dev', masterBase, devHead]);
  const aborted = await service.request('rebaseAction', { action: 'abort' }); assert.equal(aborted.branch, 'master'); assert.equal(aborted.head, masterHead);
  assert.equal(aborted.rebaseSavedChanges?.status, 'restore-pending'); assert.equal(git(repo, ['status', '--porcelain']), ''); assert.equal(git(repo, ['show', `${ref}:dirty.txt`]), 'UNSTAGED_PRIVATE');
  await assert.rejects(service.request('commit', { message: 'must not commit while WIP recovery pending' }));
  git(repo, ['update-ref', 'refs/heads/dev', devHead, masterBase]); const restored = await service.request('rebaseSavedAction', { action: 'restore' });
  assert.equal(restored.branch, 'dev'); assert.equal(restored.rebaseSavedChanges?.status, 'restored'); await assertWip(repo);
});

test('saved changes rebase: failed index restore permits explicit unstaged fallback only before any partial write', async () => {
  const { repo, devHead } = await fixture(); git(repo, ['switch', 'master']);
  const target = await commit(repo, 'dirty.txt', 'UPSTREAM\n', 'upstream modifies staged line'); git(repo, ['switch', 'dev']);
  await writeFile(path.join(repo, 'dirty.txt'), 'INDEX_ONLY\n'); git(repo, ['add', '--', 'dirty.txt']); await writeFile(path.join(repo, 'dirty.txt'), 'base\n');
  await writeFile(path.join(repo, '未跟踪.txt'), 'PRIVATE\n'); const { service } = await open(repo);
  const stopped = await service.request('rebase', { targetCommit: target, expectedHead: devHead, autoSaveChanges: true });
  assert.equal(stopped.rebaseSavedChanges?.status, 'restore-pending'); assert.equal(stopped.entries.length, 0);
  const ref = savedRef(repo, stopped, devHead); const restored = await service.request('rebaseSavedAction', { action: 'restore-unstaged' });
  assert.equal(restored.rebaseSavedChanges?.status, 'restored'); assert.equal(git(repo, ['show', ':dirty.txt']), 'UPSTREAM');
  assert.equal(await readFile(path.join(repo, '未跟踪.txt'), 'utf8'), 'PRIVATE\n'); assert.equal(git(repo, ['show', `${ref}^2:dirty.txt`]), 'INDEX_ONLY');
});
