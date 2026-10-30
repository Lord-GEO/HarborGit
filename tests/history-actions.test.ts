import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService } from '../src/main/git-service';
import type { Repository } from '../src/shared/types';

const base = fileURLToPath(new URL('../../../work/history-actions', import.meta.url));
const roots: string[] = [];
function git(cwd: string, args: string[], accepted = [0]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true, env: {
    ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '.harbor-test-global'), GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no',
  } });
  if (result.error) throw result.error;
  assert.ok(accepted.includes(result.status ?? -1), `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
async function fixture() {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-history-')); roots.push(root);
  const repo = path.join(root, '仓库 space'); await mkdir(repo);
  git(repo, ['init', '--initial-branch=master']);
  for (const [key, value] of [['user.name', 'History Fixture'], ['user.email', 'history@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['core.logallrefupdates', 'true']]) git(repo, ['config', '--local', key, value]);
  return { root, repo };
}
async function commit(repo: string, file: string, content: string, message: string) {
  await writeFile(path.join(repo, file), content); git(repo, ['add', '--', file]); git(repo, ['commit', '-m', message]); return git(repo, ['rev-parse', 'HEAD']);
}
async function open(repo: string) { const service = new GitService(); const state = await service.request('open', { path: repo }); return { service, state }; }
async function backup(repo: string, state: Repository, original: string) {
  assert.match(state.historyBackup || '', /^refs\/harborgit\/backups\//);
  assert.equal(git(repo, ['rev-parse', state.historyBackup!]), original);
  const reopened = await open(repo); assert.equal(reopened.state.historyBackup, state.historyBackup);
}
async function conflictFixture() {
  const value = await fixture(); await commit(value.repo, '冲突 文件.txt', 'base\n', 'base');
  git(value.repo, ['switch', '-c', 'dev']);
  const original = await commit(value.repo, '冲突 文件.txt', 'dev\n', 'dev edit');
  git(value.repo, ['switch', 'master']); const target = await commit(value.repo, '冲突 文件.txt', 'master\n', 'master edit');
  git(value.repo, ['switch', 'dev']); return { ...value, original, target, ...(await open(value.repo)) };
}
test.after(async () => {
  for (const root of roots) {
    assert.ok(path.resolve(root).startsWith(base + path.sep) && path.basename(root).startsWith('harborgit-history-'));
    await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
});

test('rebase changes only current branch, preserves all requested commits and an original-head backup', async () => {
  const { repo } = await fixture(); await commit(repo, 'base.txt', 'base\n', 'base');
  git(repo, ['switch', '-c', 'dev']); const original = await commit(repo, '功能 中文.txt', 'feature\n', 'feature');
  git(repo, ['branch', 'side']);
  // A user configuration must not let rebase silently rewrite another branch.
  git(repo, ['config', 'rebase.updateRefs', 'true']);
  git(repo, ['switch', 'master']); const upstream = await commit(repo, 'master.txt', 'main\n', 'master feature');
  git(repo, ['switch', 'dev']); const { service } = await open(repo);
  const result = await service.request('rebase', { branch: 'master', expectedHead: original });
  assert.equal(result.operation, undefined); assert.equal(result.branch, 'dev'); assert.notEqual(result.head, original);
  assert.equal(git(repo, ['rev-parse', 'HEAD^']), upstream); assert.equal(git(repo, ['rev-parse', 'side']), original);
  assert.equal(await readFile(path.join(repo, '功能 中文.txt'), 'utf8'), 'feature\n');
  await backup(repo, result, original);
});

test('rebase conflict survives reopening, exposes correct ours/theirs, continues without a terminal editor', async () => {
  const { repo, service, original } = await conflictFixture();
  const stopped = await service.request('rebase', { branch: 'master', expectedHead: original });
  assert.equal(stopped.operation?.kind, 'rebase'); assert.ok(stopped.entries.some(file => file.conflict));
  const reopened = await open(repo); assert.equal(reopened.state.operation?.kind, 'rebase');
  const sides = await reopened.service.request('conflict', { path: '冲突 文件.txt' });
  assert.equal(sides.ours, 'master\n'); assert.equal(sides.theirs, 'dev\n');
  await assert.rejects(reopened.service.request('commit', { message: 'wrong normal commit' }));
  await assert.rejects(reopened.service.request('checkout', { name: 'master' }));
  await reopened.service.request('resolve', { path: '冲突 文件.txt', choice: 'manual', content: 'master and dev\n' });
  const unstaged = await reopened.service.request('unstage', { paths: ['冲突 文件.txt'] });
  assert.equal(unstaged.operation?.kind, 'rebase');
  assert.equal(await readFile(path.join(repo, '冲突 文件.txt'), 'utf8'), 'master and dev\n');
  await reopened.service.request('stage', { paths: ['冲突 文件.txt'] });
  const result = await reopened.service.request('rebaseAction', { action: 'continue' });
  assert.equal(result.operation, undefined); assert.equal(result.branch, 'dev');
  assert.equal(await readFile(path.join(repo, '冲突 文件.txt'), 'utf8'), 'master and dev\n'); await backup(repo, result, original);
});

test('rebase skip omits only the conflicting commit and replays the following commit', async () => {
  const { repo, service, original } = await conflictFixture();
  const last = await commit(repo, '后续.txt', 'keep\n', 'next feature');
  assert.equal((await service.request('rebase', { branch: 'master', expectedHead: last })).operation?.kind, 'rebase');
  const result = await service.request('rebaseAction', { action: 'skip' });
  assert.equal(result.operation, undefined); assert.equal(await readFile(path.join(repo, '冲突 文件.txt'), 'utf8'), 'master\n');
  assert.equal(await readFile(path.join(repo, '后续.txt'), 'utf8'), 'keep\n'); assert.notEqual(result.head, original);
});

test('rebase abort restores branch tip, content and a clean index', async () => {
  const { repo, service, original } = await conflictFixture();
  await service.request('rebase', { branch: 'master', expectedHead: original });
  const result = await service.request('rebaseAction', { action: 'abort' });
  assert.equal(result.operation, undefined); assert.equal(result.head, original); assert.equal(result.branch, 'dev');
  assert.equal(result.entries.length, 0); assert.equal(await readFile(path.join(repo, '冲突 文件.txt'), 'utf8'), 'dev\n');
});

test('rebase honors --rebase-merges and works in a linked worktree without touching its sibling', async () => {
  const { root, repo } = await fixture(); await commit(repo, 'base.txt', 'base\n', 'base');
  git(repo, ['switch', '-c', 'dev']); await commit(repo, 'dev.txt', 'dev\n', 'dev feature');
  git(repo, ['switch', '-c', 'topic']); await commit(repo, 'topic.txt', 'topic\n', 'topic feature');
  git(repo, ['switch', 'dev']); await commit(repo, 'other.txt', 'other\n', 'dev other');
  git(repo, ['merge', '--no-ff', 'topic', '-m', 'merge topic']); const original = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['switch', 'master']); await commit(repo, 'master.txt', 'main\n', 'main feature');
  const master = git(repo, ['rev-parse', 'HEAD']); const linked = path.join(root, 'linked 工作区');
  git(repo, ['worktree', 'add', linked, 'dev']);
  const { service } = await open(linked);
  const result = await service.request('rebase', { branch: 'master', preserveMerges: true, expectedHead: original });
  assert.equal(result.operation, undefined); assert.equal(git(linked, ['rev-list', '--merges', 'master..HEAD', '--count']), '1');
  assert.equal(git(repo, ['rev-parse', 'HEAD']), master); assert.equal(git(repo, ['status', '--porcelain']), '');
});

test('rebase rejects dirty or stale state and unsafe target syntax without modifying data', async () => {
  const { repo, service, original } = await conflictFixture();
  await writeFile(path.join(repo, '冲突 文件.txt'), 'uncommitted\n');
  await assert.rejects(service.request('rebase', { branch: 'master', expectedHead: original }));
  assert.equal(await readFile(path.join(repo, '冲突 文件.txt'), 'utf8'), 'uncommitted\n');
  git(repo, ['restore', '--', '冲突 文件.txt']);
  await assert.rejects(service.request('rebase', { branch: 'master', expectedHead: '0'.repeat(40) }));
  await assert.rejects(service.request('rebase', { branch: '--exec=malicious', expectedHead: original }));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), original); assert.equal((await service.request('refresh', {})).operation, undefined);
});

test('ordinary ignored build artifacts do not prevent a clean rebase or revert', async () => {
  const { repo } = await fixture(); await commit(repo, 'base.txt', 'base\n', 'base');
  git(repo, ['switch', '-c', 'dev']); const original = await commit(repo, 'feature.txt', 'feature\n', 'feature');
  git(repo, ['switch', 'master']); await commit(repo, 'master.txt', 'main\n', 'master feature'); git(repo, ['switch', 'dev']);
  await writeFile(path.join(repo, '.git/info/exclude'), 'node_modules/\n'); await mkdir(path.join(repo, 'node_modules'));
  await writeFile(path.join(repo, 'node_modules/private.txt'), 'ignored build output\n');
  const { service } = await open(repo); const result = await service.request('rebase', { branch: 'master', expectedHead: original });
  assert.equal(result.operation, undefined); assert.equal(result.entries.length, 0);
  const reverted = await service.request('revert', { hash: result.head, expectedHead: result.head });
  assert.equal(reverted.operation, undefined); assert.equal(await readFile(path.join(repo, 'node_modules/private.txt'), 'utf8'), 'ignored build output\n');
});

test('ignored paths touched by intermediate replay commits or revert parents are protected', async () => {
  const { repo } = await fixture(); await commit(repo, 'base.txt', 'base\n', 'base'); git(repo, ['switch', '-c', 'dev']);
  await commit(repo, 'ignored-target.txt', 'intermediate tracked\n', 'add intermediate');
  git(repo, ['rm', '--', 'ignored-target.txt']); git(repo, ['commit', '-m', 'remove intermediate']); const removed = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['switch', 'master']); await commit(repo, 'master.txt', 'main\n', 'main feature'); git(repo, ['switch', 'dev']);
  await writeFile(path.join(repo, '.git/info/exclude'), 'ignored-target.txt\n'); await writeFile(path.join(repo, 'ignored-target.txt'), 'ignored private\n');
  const { service } = await open(repo);
  await assert.rejects(service.request('rebase', { branch: 'master', expectedHead: removed }));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), removed);
  await assert.rejects(service.request('revert', { hash: removed, expectedHead: removed }));
  assert.equal(await readFile(path.join(repo, 'ignored-target.txt'), 'utf8'), 'ignored private\n'); assert.equal(git(repo, ['rev-parse', 'HEAD']), removed);
});

test('revert adds a new inverse commit, retains original history, and supports a merge mainline', async () => {
  const { repo } = await fixture(); const baseHead = await commit(repo, 'base.txt', 'base\n', 'base');
  const original = await commit(repo, 'feature.txt', 'feature\n', 'feature'); const { service } = await open(repo);
  const result = await service.request('revert', { hash: original, expectedHead: original });
  assert.notEqual(result.head, baseHead); assert.equal(git(repo, ['rev-parse', 'HEAD^']), original);
  assert.equal(git(repo, ['ls-tree', '--name-only', 'HEAD']), 'base.txt'); await backup(repo, result, original);
  git(repo, ['switch', '-c', 'topic']); await commit(repo, 'merge.txt', 'merge\n', 'merge feature');
  git(repo, ['switch', 'master']); git(repo, ['merge', '--no-ff', 'topic', '-m', 'merge topic']); const merge = git(repo, ['rev-parse', 'HEAD']);
  await assert.rejects(service.request('revert', { hash: merge, expectedHead: merge }));
  const reverted = await service.request('revert', { hash: merge, mainline: 1, expectedHead: merge });
  assert.equal(reverted.operation, undefined); assert.equal(git(repo, ['rev-parse', 'HEAD^']), merge);
  assert.doesNotMatch(git(repo, ['ls-tree', '--name-only', 'HEAD']), /merge.txt/);
});

test('revert conflict supports reopen, continue and abort without altering other commits', async () => {
  const { repo } = await fixture(); await commit(repo, '共享.txt', 'base\n', 'base');
  const middle = await commit(repo, '共享.txt', 'middle\n', 'middle'); const original = await commit(repo, '共享.txt', 'latest\n', 'latest');
  const { service } = await open(repo); const stopped = await service.request('revert', { hash: middle, expectedHead: original });
  assert.equal(stopped.operation?.kind, 'revert'); assert.ok(stopped.entries.some(e => e.conflict));
  const resumed = await open(repo); assert.equal(resumed.state.operation?.kind, 'revert');
  await resumed.service.request('resolve', { path: '共享.txt', choice: 'manual', content: 'reverted manually\n' });
  const complete = await resumed.service.request('revertAction', { action: 'continue' });
  assert.equal(complete.operation, undefined); assert.equal(git(repo, ['rev-parse', 'HEAD^']), original);
  // Recreate the initial state only in this dedicated test repository.
  git(repo, ['reset', '--hard', original]); await service.request('revert', { hash: middle, expectedHead: original });
  const aborted = await service.request('revertAction', { action: 'abort' });
  assert.equal(aborted.operation, undefined); assert.equal(aborted.head, original); assert.equal(aborted.entries.length, 0);
  assert.equal(await readFile(path.join(repo, '共享.txt'), 'utf8'), 'latest\n');
});

test('reset soft and mixed preserve worktree bytes and follow distinct index semantics', async () => {
  for (const mode of ['soft', 'mixed'] as const) {
    const { repo } = await fixture(); const target = await commit(repo, '文件.txt', 'base\n', 'base');
    const original = await commit(repo, '文件.txt', 'committed\n', 'change');
    await writeFile(path.join(repo, '文件.txt'), 'staged\n'); git(repo, ['add', '--', '文件.txt']); await writeFile(path.join(repo, '文件.txt'), 'working\n');
    const { service } = await open(repo); const result = await service.request('reset', { hash: target, mode, expectedHead: original });
    assert.equal(result.head, target); assert.equal(await readFile(path.join(repo, '文件.txt'), 'utf8'), 'working\n');
    assert.equal(git(repo, ['show', ':文件.txt']), mode === 'soft' ? 'staged' : 'base'); await backup(repo, result, original);
  }
});

test('reset hard requires explicit discard, saves original tip and blocks unrelated commits', async () => {
  const { repo } = await fixture(); const target = await commit(repo, 'file.txt', 'base\n', 'base');
  const original = await commit(repo, 'file.txt', 'committed\n', 'change'); await writeFile(path.join(repo, 'file.txt'), 'working\n');
  const { service } = await open(repo);
  await assert.rejects(service.request('reset', { hash: target, mode: 'hard', expectedHead: original }));
  assert.equal(await readFile(path.join(repo, 'file.txt'), 'utf8'), 'working\n');
  const result = await service.request('reset', { hash: target, mode: 'hard', expectedHead: original, discard: true });
  assert.equal(result.head, target); assert.equal(result.entries.length, 0); assert.equal(await readFile(path.join(repo, 'file.txt'), 'utf8'), 'base\n'); await backup(repo, result, original);
  git(repo, ['switch', '-c', 'other']); const other = await commit(repo, 'other.txt', 'other\n', 'other'); git(repo, ['switch', 'master']);
  await assert.rejects(service.request('reset', { hash: other, mode: 'mixed', expectedHead: target }));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), target);
});

test('reset hard refuses untracked or ignored data rather than silently removing blockers', async () => {
  const { repo } = await fixture(); const target = await commit(repo, 'blocker.txt', 'tracked old\n', 'base');
  git(repo, ['rm', '--', 'blocker.txt']); git(repo, ['commit', '-m', 'remove blocker']); const original = git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'blocker.txt'), 'private untracked\n'); const { service } = await open(repo);
  await assert.rejects(service.request('reset', { hash: target, mode: 'hard', expectedHead: original, discard: true }));
  assert.equal(await readFile(path.join(repo, 'blocker.txt'), 'utf8'), 'private untracked\n');
  assert.equal(git(repo, ['rev-parse', 'HEAD']), original);
});

test('reset hard preserves unrelated untracked files and ignored build directories', async () => {
  const { repo } = await fixture(); const target = await commit(repo, 'file.txt', 'base\n', 'base');
  const original = await commit(repo, 'file.txt', 'committed\n', 'change');
  await writeFile(path.join(repo, 'file.txt'), 'discard this tracked change\n');
  await writeFile(path.join(repo, 'private.txt'), 'keep untracked\n');
  await writeFile(path.join(repo, '.git/info/exclude'), 'node_modules/\n'); await mkdir(path.join(repo, 'node_modules'));
  await writeFile(path.join(repo, 'node_modules/build.txt'), 'keep ignored\n');
  const { service } = await open(repo); const result = await service.request('reset', { hash: target, mode: 'hard', expectedHead: original, discard: true });
  assert.equal(result.head, target); assert.equal(await readFile(path.join(repo, 'file.txt'), 'utf8'), 'base\n');
  assert.equal(await readFile(path.join(repo, 'private.txt'), 'utf8'), 'keep untracked\n');
  assert.equal(await readFile(path.join(repo, 'node_modules/build.txt'), 'utf8'), 'keep ignored\n');
});

test('rollback uses literal selected paths, distinguishes worktree/index, and handles renamed files', async () => {
  const { repo } = await fixture(); await commit(repo, 'a[1] 中文.txt', 'base\n', 'base');
  const original = await commit(repo, '-leading.txt', 'other\n', 'other');
  await writeFile(path.join(repo, 'a[1] 中文.txt'), 'staged\n'); git(repo, ['add', '--', 'a[1] 中文.txt']);
  await writeFile(path.join(repo, 'a[1] 中文.txt'), 'working\n'); await writeFile(path.join(repo, '-leading.txt'), 'keep other\n');
  const { service } = await open(repo);
  await service.request('rollback', { paths: ['a[1] 中文.txt'], scope: 'worktree', expectedHead: original, discard: true });
  assert.equal(await readFile(path.join(repo, 'a[1] 中文.txt'), 'utf8'), 'staged\n'); assert.equal(git(repo, ['show', ':a[1] 中文.txt']), 'staged');
  await service.request('rollback', { paths: ['a[1] 中文.txt'], scope: 'all', expectedHead: original, discard: true });
  assert.equal(await readFile(path.join(repo, 'a[1] 中文.txt'), 'utf8'), 'base\n'); assert.equal(git(repo, ['show', ':a[1] 中文.txt']), 'base');
  assert.equal(await readFile(path.join(repo, '-leading.txt'), 'utf8'), 'keep other\n');
  git(repo, ['mv', '--', 'a[1] 中文.txt', 'renamed 中文.txt']);
  await service.request('rollback', { paths: ['renamed 中文.txt'], scope: 'all', expectedHead: original, discard: true });
  assert.equal(await readFile(path.join(repo, 'a[1] 中文.txt'), 'utf8'), 'base\n');
  await assert.rejects(readFile(path.join(repo, 'renamed 中文.txt')));
});

test('rollback refuses untracked, added-without-HEAD, path escapes and stale HEAD without data loss', async () => {
  const { repo } = await fixture(); const original = await commit(repo, 'file.txt', 'base\n', 'base');
  await writeFile(path.join(repo, 'private.txt'), 'untracked\n'); await writeFile(path.join(repo, 'new.txt'), 'new\n'); git(repo, ['add', '--', 'new.txt']);
  const { service } = await open(repo);
  for (const paths of [['private.txt'], ['new.txt'], ['../outside.txt'], ['.git/config']]) await assert.rejects(service.request('rollback', { paths, scope: 'all', expectedHead: original, discard: true }));
  await writeFile(path.join(repo, 'file.txt'), 'keep\n');
  await assert.rejects(service.request('rollback', { paths: ['file.txt'], scope: 'all', expectedHead: '0'.repeat(40), discard: true }));
  assert.equal(await readFile(path.join(repo, 'private.txt'), 'utf8'), 'untracked\n'); assert.equal(await readFile(path.join(repo, 'new.txt'), 'utf8'), 'new\n');
  assert.equal(await readFile(path.join(repo, 'file.txt'), 'utf8'), 'keep\n');
});

test('rollback does not follow a replacement directory junction into external files', async () => {
  const { root, repo } = await fixture(); await mkdir(path.join(repo, 'dir')); const original = await commit(repo, 'dir/file.txt', 'tracked\n', 'base');
  const external = path.join(root, 'outside'); await mkdir(external); await writeFile(path.join(external, 'file.txt'), 'outside private\n');
  await rename(path.join(repo, 'dir'), path.join(root, 'original-dir'));
  await symlink(external, path.join(repo, 'dir'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const { service } = await open(repo);
    await assert.rejects(service.request('rollback', { paths: ['dir/file.txt'], scope: 'worktree', expectedHead: original, discard: true }));
    assert.equal(await readFile(path.join(external, 'file.txt'), 'utf8'), 'outside private\n');
  } finally { await rm(path.join(repo, 'dir'), { force: true }); }
});
