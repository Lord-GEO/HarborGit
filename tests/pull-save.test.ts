import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService } from '../src/main/git-service';

const base = fileURLToPath(new URL('../../../work/pull-save', import.meta.url));
const roots: string[] = [];
const config = '配置 space.yml', loose = '未跟踪 [1].bin';
function git(repo: string, args: string[]) {
  const r = spawnSync('git', args, { cwd: repo, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global'), GIT_CONFIG_COUNT: '0' } });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
async function fixture(mode: 'ff' | 'diverge' | 'conflict' | 'restore-conflict') {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'harborgit-pull-')); roots.push(root);
  const producer = path.join(root, 'producer'), bare = path.join(root, 'remote space.git'), repo = path.join(root, '仓库 中文 space');
  await mkdir(producer); git(producer, ['init', '-b', 'master']);
  const configure = (dir: string) => { for (const [key, value] of [['user.name', 'Pull Fixture'], ['user.email', 'pull@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(dir, ['config', key, value]); };
  configure(producer);
  const lines = Array.from({ length: 60 }, (_, i) => `key${i}: base`);
  await writeFile(path.join(producer, config), lines.join('\n') + '\n');
  await writeFile(path.join(producer, 'merge.txt'), 'base\n');
  git(producer, ['add', '.']); git(producer, ['commit', '-m', 'base']);
  git(root, ['init', '--bare', bare]); git(producer, ['remote', 'add', 'origin', bare]); git(producer, ['push', '-u', 'origin', 'master']);
  git(root, ['clone', '--branch', 'master', bare, repo]); configure(repo);
  if (mode === 'diverge') { await writeFile(path.join(repo, 'local.txt'), 'local commit\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'local commit']); }
  if (mode === 'conflict') { await writeFile(path.join(repo, 'merge.txt'), 'local committed\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'local conflict']); }
  const original = git(repo, ['rev-parse', 'HEAD']);
  if (mode === 'conflict') await writeFile(path.join(producer, 'merge.txt'), 'remote committed\n');
  else { lines[0] = 'key0: remote'; await writeFile(path.join(producer, config), lines.join('\n') + '\n'); }
  await writeFile(path.join(producer, 'remote.txt'), 'remote commit\n');
  git(producer, ['add', '.']); git(producer, ['commit', '-m', 'remote commit']); git(producer, ['push', 'origin', 'master']);
  const target = git(producer, ['rev-parse', 'HEAD']);
  // Preserve an unrelated pre-existing stash, then create the WIP for this Pull.
  await writeFile(path.join(repo, 'foreign.txt'), 'older stash\n'); git(repo, ['add', '.']); git(repo, ['stash', 'push', '-m', 'unrelated older stash']);
  const olderStash = git(repo, ['rev-parse', 'refs/stash']);
  lines[0] = mode === 'restore-conflict' ? 'key0: private local' : 'key0: base';
  if (mode !== 'restore-conflict') {
    lines[25] = 'key25: staged'; await writeFile(path.join(repo, config), lines.join('\n') + '\n'); git(repo, ['add', '--', config]); lines[45] = 'key45: unstaged';
  }
  await writeFile(path.join(repo, config), lines.join('\n') + '\n');
  await writeFile(path.join(repo, loose), Buffer.from([0, 255, 10, 128]));
  const service = new GitService(); await service.request('open', { path: repo });
  const pull = () => service.request('remote', { action: 'pull', remote: 'origin', branch: 'master', autoSaveChanges: true, expectedHead: original, expectedBranch: 'master' });
  return { root, repo, bare, service, original, target, olderStash, pull };
}
async function checkRestored(repo: string) {
  assert.match(git(repo, ['show', `:${config}`]), /key25: staged/);
  assert.doesNotMatch(git(repo, ['show', `:${config}`]), /key45: unstaged/);
  assert.match(await readFile(path.join(repo, config), 'utf8'), /key45: unstaged/);
  assert.deepEqual(await readFile(path.join(repo, loose)), Buffer.from([0, 255, 10, 128]));
  assert.equal(git(repo, ['for-each-ref', '--format=%(refname)', 'refs/harborgit/fetch']), '');
}
test.after(async () => {
  for (const root of roots) { assert.equal(path.dirname(path.resolve(root)), path.resolve(base)); assert.ok(path.basename(root).startsWith('harborgit-pull-')); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
});

test('Pull fetch failure leaves WIP untouched; fast-forward restores index, worktree, binary untracked and older stash', async () => {
  const { repo, service, original, target, olderStash, pull } = await fixture('ff');
  await assert.rejects(service.request('remote', { action: 'pull', remote: 'origin', branch: 'master', autoSaveChanges: false }), /开启自动保存/);
  await assert.rejects(service.request('remote', { action: 'pull', remote: 'origin', branch: 'master', expectedHead: '0'.repeat(40) }), /HEAD 已变化/);
  await assert.rejects(service.request('remote', { action: 'pull', remote: 'origin', branch: 'missing' }));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), original); assert.equal(git(repo, ['rev-parse', 'refs/stash']), olderStash);
  const done = await pull();
  assert.equal(done.head, target); assert.equal(done.behind, 0); assert.equal(done.ahead, 0);
  assert.equal(git(repo, ['rev-parse', 'origin/master']), target);
  assert.equal(done.rebaseSavedChanges?.kind, 'pull'); assert.equal(done.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['rev-parse', `${done.rebaseSavedChanges!.ref}^1`]), original);
  assert.equal(git(repo, ['rev-parse', 'stash@{1}']), olderStash);
  await checkRestored(repo); assert.match(await readFile(path.join(repo, config), 'utf8'), /key0: remote/);
  const stashes = git(repo, ['stash', 'list', '--format=%H']);
  const upToDate = await service.request('remote', { action: 'pull', remote: 'origin', branch: 'master', expectedHead: target });
  assert.deepEqual(upToDate.entries, done.entries);
  assert.equal(upToDate.rebaseSavedChanges?.ref, done.rebaseSavedChanges?.ref);
  assert.equal(git(repo, ['stash', 'list', '--format=%H']), stashes);
  assert.equal(git(repo, ['for-each-ref', '--format=%(refname)', 'refs/harborgit/fetch']), '');
});

test('divergent Pull creates a two-parent merge then restores WIP without committing private modifications', async () => {
  const { repo, pull, original, target } = await fixture('diverge');
  const done = await pull(); assert.equal(done.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['show', '-s', '--format=%P', 'HEAD']), `${original} ${target}`);
  assert.doesNotMatch(git(repo, ['show', `HEAD:${config}`]), /staged|unstaged/);
  await checkRestored(repo);
});

test('remote merge conflict survives reopen; resolve and commit merge automatically restores saved WIP', async () => {
  const { repo, pull, original, target } = await fixture('conflict');
  const paused = await pull(); assert.equal(paused.mergeInProgress, true); assert.equal(paused.rebaseSavedChanges?.status, 'saved');
  assert.equal(await readFile(path.join(repo, loose)).then(() => true, () => false), false);
  const reopened = new GitService(); const state = await reopened.request('open', { path: repo });
  assert.equal(state.rebaseSavedChanges?.pullPhase, 'merging'); assert.equal(state.rebaseSavedChanges?.status, 'saved');
  await reopened.request('resolve', { path: 'merge.txt', choice: 'manual', content: 'both committed changes\n' });
  const done = await reopened.request('commit', { message: 'merge remote master' });
  assert.equal(done.mergeInProgress, false); assert.equal(done.rebaseSavedChanges?.status, 'restored');
  assert.equal(git(repo, ['show', '-s', '--format=%P', 'HEAD']), `${original} ${target}`); await checkRestored(repo);
});

test('aborting remote merge restores original HEAD and original staged and unstaged modifications', async () => {
  const { repo, service, pull, original } = await fixture('conflict'); await pull();
  const done = await service.request('abortMerge', {});
  assert.equal(done.head, original); assert.equal(done.mergeInProgress, false); assert.equal(done.rebaseSavedChanges?.pullFailed, true);
  assert.equal(done.rebaseSavedChanges?.status, 'restored'); await checkRestored(repo);
});

test('WIP restore conflict is separate from remote merge, cannot be replayed, and can be resolved without a merge commit', async () => {
  const { repo, service, pull, target } = await fixture('restore-conflict');
  const paused = await pull(); assert.equal(paused.head, target); assert.equal(paused.mergeInProgress, false);
  assert.equal(paused.rebaseSavedChanges?.status, 'restore-conflicts');
  const before = await readFile(path.join(repo, config), 'utf8');
  await service.request('rebaseSavedAction', { action: 'restore' }); assert.equal(await readFile(path.join(repo, config), 'utf8'), before);
  await service.request('resolve', { path: config, choice: 'manual', content: 'remote and private local\n' });
  const done = await service.request('rebaseSavedAction', { action: 'finish' });
  assert.equal(done.head, target); assert.equal(done.rebaseSavedChanges?.status, 'restored');
  assert.deepEqual(await readFile(path.join(repo, loose)), Buffer.from([0, 255, 10, 128]));
});
