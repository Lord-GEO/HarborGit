import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitError, GitService } from '../src/main/git-service';
import type { CheckoutPrompt } from '../src/shared/types';

const base = fileURLToPath(new URL('../../../work/checkout-save', import.meta.url));
const roots: string[] = [];
function git(repo: string, args: string[]) {
  const r = spawnSync('git', args, { cwd: repo, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global'), GIT_CONFIG_COUNT: '0' } });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
const config = 'application-dev.yml';
async function fixture(conflict = false) {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'harborgit-checkout-')); roots.push(root);
  const repo = path.join(root, '仓库 中文 space'); await mkdir(repo);
  git(repo, ['init', '-b', 'master']);
  for (const [key, value] of [['user.name', 'Checkout Fixture'], ['user.email', 'checkout@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(repo, ['config', key, value]);
  const lines = Array.from({ length: 60 }, (_, i) => `key${i}: base`);
  await writeFile(path.join(repo, config), lines.join('\n') + '\n');
  await writeFile(path.join(repo, 'other.txt'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']);
  git(repo, ['switch', '-c', 'dev']); lines[0] = 'key0: dev';
  await writeFile(path.join(repo, config), lines.join('\n') + '\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'dev']);
  const original = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['switch', 'master']); lines[0] = 'key0: master';
  await writeFile(path.join(repo, config), lines.join('\n') + '\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'master']);
  const target = git(repo, ['rev-parse', 'HEAD']); git(repo, ['switch', 'dev']);
  lines[0] = 'key0: dev'; lines[conflict ? 0 : 30] = conflict ? 'key0: local' : 'key30: staged';
  await writeFile(path.join(repo, config), lines.join('\n') + '\n');
  if (!conflict) { git(repo, ['add', '--', config]); lines[45] = 'key45: unstaged'; await writeFile(path.join(repo, config), lines.join('\n') + '\n'); }
  await writeFile(path.join(repo, '未跟踪 [1].txt'), 'untracked private\n');
  const service = new GitService(); await service.request('open', { path: repo });
  return { root, repo, service, original, target };
}
async function prompt(service: GitService): Promise<CheckoutPrompt> {
  try { await service.request('checkout', { name: 'master' }); assert.fail('Expected checkout protection'); }
  catch (e) { assert.ok(e instanceof GitError); assert.ok(e.details.checkout); return e.details.checkout; }
}
const payload = (p: CheckoutPrompt) => ({ name: p.name, smart: true, expectedHead: p.expectedHead, expectedBranch: p.originalBranch, expectedTargetHead: p.expectedTargetHead });
test.after(async () => {
  for (const root of roots) { assert.equal(path.dirname(path.resolve(root)), path.resolve(base)); assert.ok(path.basename(root).startsWith('harborgit-checkout-')); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
});

test('smart checkout carries staged, unstaged and untracked changes to target without moving branch tips', async () => {
  const { repo, service, original, target } = await fixture();
  const p = await prompt(service);
  assert.equal(git(repo, ['branch', '--show-current']), 'dev'); assert.equal(git(repo, ['stash', 'list']), '');
  assert.ok(p.paths.includes(config)); assert.ok(p.paths.includes('未跟踪 [1].txt'));
  const result = await service.request('checkout', payload(p));
  assert.equal(result.branch, 'master'); assert.equal(result.head, target);
  assert.equal(result.rebaseSavedChanges?.kind, 'checkout'); assert.equal(result.rebaseSavedChanges?.status, 'restored');
  assert.match(git(repo, ['show', `:${config}`]), /key0: master[\s\S]*key30: staged/);
  assert.match(await readFile(path.join(repo, config), 'utf8'), /key45: unstaged/);
  assert.equal(await readFile(path.join(repo, '未跟踪 [1].txt'), 'utf8'), 'untracked private\n');
  assert.equal(git(repo, ['rev-parse', 'dev']), original); assert.equal(git(repo, ['rev-parse', 'master']), target);
  assert.equal(git(repo, ['rev-parse', `${result.rebaseSavedChanges!.ref}^1`]), original);
  assert.ok(git(repo, ['stash', 'list']).includes('HarborGit checkout autosave'));
});

test('checkout restore conflict survives reopen, does not reapply, and resolves as WIP rather than rebase', async () => {
  const { repo, service, target } = await fixture(true);
  const stopped = await service.request('checkout', payload(await prompt(service)));
  assert.equal(stopped.branch, 'master'); assert.equal(stopped.head, target); assert.equal(stopped.operation, undefined);
  assert.equal(stopped.rebaseSavedChanges?.status, 'restore-conflicts');
  const other = new GitService(); const opened = await other.request('open', { path: repo });
  assert.equal(opened.rebaseSavedChanges?.ref, stopped.rebaseSavedChanges?.ref);
  const before = await readFile(path.join(repo, config), 'utf8');
  await other.request('rebaseSavedAction', { action: 'restore' }); assert.equal(await readFile(path.join(repo, config), 'utf8'), before);
  await other.request('resolve', { path: config, choice: 'manual', content: 'resolved target and local\n' });
  const done = await other.request('rebaseSavedAction', { action: 'finish' });
  assert.equal(done.branch, 'master'); assert.equal(done.rebaseSavedChanges?.status, 'restored'); assert.equal(done.operation, undefined);
  assert.equal(await readFile(path.join(repo, '未跟踪 [1].txt'), 'utf8'), 'untracked private\n');
});

test('target index restore can fail cleanly and retry without index without misreporting partial writes', async () => {
  const { repo, service, target } = await fixture(true);
  git(repo, ['add', '--', config]);
  const stopped = await service.request('checkout', payload(await prompt(service)));
  assert.equal(stopped.branch, 'master'); assert.equal(stopped.head, target);
  assert.equal(stopped.rebaseSavedChanges?.status, 'restore-pending');
  assert.equal(stopped.entries.length, 0);
  assert.match(stopped.rebaseSavedChanges!.message, /已确认工作区与索引未被部分修改/);
  const retry = await service.request('rebaseSavedAction', { action: 'restore-unstaged' });
  assert.equal(retry.branch, 'master'); assert.equal(retry.rebaseSavedChanges?.status, 'restore-conflicts');
  assert.ok(retry.entries.some(entry => entry.path === config && entry.conflict));
  assert.equal(await readFile(path.join(repo, '未跟踪 [1].txt'), 'utf8'), 'untracked private\n');
});

test('smart checkout rejects stale targets and untracked target collisions before creating WIP', async () => {
  const { repo, service, original, target } = await fixture(); const p = await prompt(service);
  git(repo, ['update-ref', 'refs/heads/master', original]);
  await assert.rejects(service.request('checkout', payload(p)), /目标分支已变化/);
  assert.equal(git(repo, ['stash', 'list']), ''); assert.equal(git(repo, ['branch', '--show-current']), 'dev');
  git(repo, ['update-ref', 'refs/heads/master', target]);
  // An ignored blocker must also be rejected without moving source WIP.
  await writeFile(path.join(repo, '.git/info/exclude'), 'ignored.txt\n'); await writeFile(path.join(repo, 'ignored.txt'), 'private ignored\n');
  // Install a target-only tracked path using a separate temporary worktree.
  const temp = path.join(path.dirname(repo), 'target-tree'); git(repo, ['worktree', 'add', '--detach', temp, target]);
  await writeFile(path.join(temp, 'ignored.txt'), 'target\n'); git(temp, ['add', '-f', '--', 'ignored.txt']); git(temp, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'target path']);
  const tip = git(temp, ['rev-parse', 'HEAD']); git(repo, ['worktree', 'remove', temp]); git(repo, ['update-ref', 'refs/heads/master', tip]);
  await assert.rejects(service.request('checkout', { name: 'master' }), /被忽略内容/);
  await assert.rejects(service.request('checkout', { ...payload(p), expectedTargetHead: tip }), /忽略内容/);
  assert.equal(git(repo, ['stash', 'list']), ''); assert.equal(await readFile(path.join(repo, 'ignored.txt'), 'utf8'), 'private ignored\n');
  await writeFile(path.join(repo, '.git/info/exclude'), '');
  await assert.rejects(service.request('checkout', { ...payload(p), expectedTargetHead: tip }), /未跟踪内容重名/);
  assert.equal(git(repo, ['stash', 'list']), '');
});

test('interrupted checkout journal recovers to the actual target without automatically applying WIP on reopen', async () => {
  const { repo, service, original, target } = await fixture(); const p = await prompt(service);
  // Stop after saving by emulating an interruption immediately before the
  // first switch process; the real child may finish before cancellation.
  let interrupted = false; let controlled: GitService;
  controlled = new GitService({ onActivity: event => {
    if (event.kind === 'start' && event.command === 'git switch master' && !interrupted) {
      interrupted = true; controlled.cancel(event.id);
    }
  } });
  await controlled.request('open', { path: repo });
  const result = await controlled.request('checkout', payload(p));
  assert.ok(interrupted); assert.ok(['dev', 'master'].includes(result.branch));
  assert.equal(git(repo, ['rev-parse', 'dev']), original); assert.equal(git(repo, ['rev-parse', 'master']), target);
  assert.ok(result.rebaseSavedChanges?.ref);
  assert.match(git(repo, ['show', `${result.rebaseSavedChanges!.ref}:${config}`]), /key45: unstaged/);
  // Reopening a completed/paused restore must never replay the same apply.
  const bytes = await readFile(path.join(repo, config), 'utf8');
  const reopened = await new GitService().request('open', { path: repo });
  assert.equal(await readFile(path.join(repo, config), 'utf8'), bytes);
  assert.equal(reopened.rebaseSavedChanges?.ref, result.rebaseSavedChanges?.ref);
});
