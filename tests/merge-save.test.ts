import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService } from '../src/main/git-service';

const base = fileURLToPath(new URL('../../../work/merge-save', import.meta.url));
const roots: string[] = [];
const config = 'synergia-service/synergia-omp/src/main/resources/application-dev.yml';
const gateway = 'synergia-gateway/src/main/resources/application-dev.yml';
const bootstrap = 'synergia-gateway/src/main/resources/bootstrap.yml';
const loose = '未跟踪 空格 [1].bin';
function git(repo: string, args: string[]) {
  const r = spawnSync('git', args, { cwd: repo, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global'), GIT_CONFIG_COUNT: '0' } });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
async function fixture(mode: 'ff' | 'conflict' | 'restore-conflict') {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'harborgit-merge-')); roots.push(root);
  const repo = path.join(root, '仓库 中文 space'); await mkdir(repo); git(repo, ['init', '-b', 'master']);
  for (const [key, value] of [['user.name', 'Merge Fixture'], ['user.email', 'merge@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(repo, ['config', key, value]);
  const lines = Array.from({ length: 65 }, (_, i) => `key${i}: base`);
  for (const file of [config, gateway, bootstrap]) { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), file === config ? lines.join('\n') + '\n' : 'base\n'); }
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']); git(repo, ['switch', '-c', 'dev']);
  lines[0] = 'key0: dev committed'; await writeFile(path.join(repo, config), lines.join('\n') + '\n');
  await writeFile(path.join(repo, 'incoming.txt'), 'committed dev file\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'dev commit']);
  const target = git(repo, ['rev-parse', 'refs/heads/dev']); git(repo, ['switch', 'master']);
  if (mode === 'conflict') { lines[0] = 'key0: master committed'; await writeFile(path.join(repo, config), lines.join('\n') + '\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'master commit']); }
  const original = git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, gateway), 'older unrelated stash\n'); git(repo, ['stash', 'push', '-m', 'keep older stash']); const older = git(repo, ['rev-parse', 'refs/stash']);
  lines[0] = mode === 'conflict' ? 'key0: master committed' : mode === 'restore-conflict' ? 'key0: private local' : 'key0: base';
  if (mode === 'ff') { lines[25] = 'key25: staged local'; await writeFile(path.join(repo, config), lines.join('\n') + '\n'); git(repo, ['add', '--', config]); }
  lines[50] = 'key50: unstaged local'; await writeFile(path.join(repo, config), lines.join('\n') + '\n');
  await writeFile(path.join(repo, gateway), 'private gateway\n'); await writeFile(path.join(repo, bootstrap), 'private bootstrap staged\n'); git(repo, ['add', '--', bootstrap]);
  await writeFile(path.join(repo, loose), Buffer.from([255, 0, 100, 128]));
  const service = new GitService(); await service.request('open', { path: repo });
  const payload = { branch: 'dev', autoSaveChanges: true, expectedHead: original, expectedBranch: 'master', expectedTargetHead: target };
  return { root, repo, service, original, target, older, payload, lines };
}
async function restored(repo: string, older: string) {
  assert.equal(git(repo, ['show', `:${bootstrap}`]), 'private bootstrap staged');
  assert.equal(git(repo, ['show', `:${gateway}`]), 'base');
  assert.equal(await readFile(path.join(repo, gateway), 'utf8'), 'private gateway\n');
  assert.match(await readFile(path.join(repo, config), 'utf8'), /key50: unstaged local/);
  assert.deepEqual(await readFile(path.join(repo, loose)), Buffer.from([255, 0, 100, 128]));
  assert.equal(git(repo, ['rev-parse', 'stash@{1}']), older);
}
test.after(async () => {
  for (const root of roots) { assert.equal(path.dirname(path.resolve(root)), path.resolve(base)); assert.ok(path.basename(root).startsWith('harborgit-merge-')); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
});

test('branch merge saves the three dirty configuration files, restores staged split, and guards stale sources and untracked or ignored collisions', async () => {
  const { repo, service, original, target, older, payload } = await fixture('ff');
  await assert.rejects(service.request('merge', { ...payload, autoSaveChanges: false }), /开启自动保存/);
  await assert.rejects(service.request('merge', { ...payload, expectedTargetHead: original }), /合并源分支已变化/);
  await writeFile(path.join(repo, 'incoming.txt'), 'private incoming\n');
  await assert.rejects(service.request('merge', payload), /未跟踪/);
  await writeFile(path.join(repo, '.git/info/exclude'), 'incoming.txt\n');
  await assert.rejects(service.request('merge', payload), /忽略/);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), original); assert.equal(git(repo, ['rev-parse', 'refs/stash']), older);
  assert.equal(await readFile(path.join(repo, 'incoming.txt'), 'utf8'), 'private incoming\n');
  await rm(path.join(repo, 'incoming.txt')); await writeFile(path.join(repo, '.git/info/exclude'), '');
  // A same-name tag must not replace the selected branch as merge source.
  git(repo, ['tag', 'dev', original]);
  const done = await service.request('merge', payload);
  assert.equal(done.branch, 'master'); assert.equal(done.head, target); assert.equal(done.rebaseSavedChanges?.kind, 'merge');
  assert.equal(done.rebaseSavedChanges?.status, 'restored'); assert.equal(done.rebaseSavedChanges?.mergeBranch, 'dev');
  assert.match(git(repo, ['show', `:${config}`]), /key25: staged local/);
  assert.doesNotMatch(git(repo, ['show', `:${config}`]), /key50: unstaged local/);
  assert.doesNotMatch(git(repo, ['show', `HEAD:${config}`]), /staged local|unstaged local/);
  assert.equal(git(repo, ['rev-parse', `${done.rebaseSavedChanges!.ref}^1`]), original);
  await restored(repo, older);
  const stashes = git(repo, ['stash', 'list', '--format=%H']);
  const upToDate = await service.request('merge', { ...payload, expectedHead: target });
  assert.deepEqual(upToDate.entries, done.entries);
  assert.equal(upToDate.rebaseSavedChanges?.ref, done.rebaseSavedChanges?.ref);
  assert.equal(git(repo, ['stash', 'list', '--format=%H']), stashes);
});

test('branch merge conflicts keep WIP saved across reopen, then restore only after the merge commit', async () => {
  const { repo, service, original, target, older, payload, lines } = await fixture('conflict');
  const paused = await service.request('merge', payload);
  assert.equal(paused.mergeInProgress, true); assert.equal(paused.rebaseSavedChanges?.status, 'saved');
  assert.equal(await readFile(path.join(repo, loose)).then(() => true, () => false), false);
  const reopened = new GitService(); const opened = await reopened.request('open', { path: repo });
  assert.equal(opened.rebaseSavedChanges?.mergePhase, 'merging'); assert.equal(opened.rebaseSavedChanges?.status, 'saved');
  await assert.rejects(reopened.request('commit', { message: 'unfinished merge' }), /解决并暂存/);
  lines[0] = 'key0: master and dev committed'; lines[50] = 'key50: base';
  await reopened.request('resolve', { path: config, choice: 'manual', content: lines.join('\n') + '\n' });
  const done = await reopened.request('commit', { message: 'merge dev into master' });
  assert.equal(done.mergeInProgress, false); assert.equal(done.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['show', '-s', '--format=%P', 'HEAD']), `${original} ${target}`);
  assert.equal(git(repo, ['show', `HEAD:${bootstrap}`]), 'base');
  assert.doesNotMatch(git(repo, ['show', `HEAD:${config}`]), /unstaged local/); await restored(repo, older);
});

test('aborting saved branch merge restores original HEAD and local modifications with backups intact', async () => {
  const { repo, service, original, older, payload } = await fixture('conflict'); await service.request('merge', payload);
  const done = await service.request('abortMerge', {});
  assert.equal(done.head, original); assert.equal(done.mergeInProgress, false); assert.equal(done.rebaseSavedChanges?.mergeFailed, true);
  assert.equal(done.rebaseSavedChanges?.status, 'restored'); await restored(repo, older);
});

test('branch WIP restore conflict is not a merge in progress and cannot be applied twice', async () => {
  const { repo, service, target, payload } = await fixture('restore-conflict');
  const paused = await service.request('merge', payload);
  assert.equal(paused.head, target); assert.equal(paused.mergeInProgress, false); assert.equal(paused.rebaseSavedChanges?.status, 'restore-conflicts');
  const reopened = new GitService(); await reopened.request('open', { path: repo });
  const before = await readFile(path.join(repo, config), 'utf8'); await reopened.request('rebaseSavedAction', { action: 'restore' });
  assert.equal(await readFile(path.join(repo, config), 'utf8'), before);
  await reopened.request('resolve', { path: config, choice: 'manual', content: 'dev and local configuration\n' });
  const done = await reopened.request('rebaseSavedAction', { action: 'finish' });
  assert.equal(done.head, target); assert.equal(done.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['rev-parse', done.rebaseSavedChanges!.ref]), git(repo, ['rev-parse', 'refs/stash']));
});
