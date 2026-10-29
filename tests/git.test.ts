import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService } from '../src/main/git-service.js';
import { Workspaces } from '../src/main/workspaces.js';
import type { Activity, Repository } from '../src/shared/types.js';

// Every command in this file targets a freshly-created, dedicated test directory.
// No global Git configuration or internet remotes are used.
const temporaryRoots: string[] = [];
const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../work/git-integration');
const clean = (value: string) => value.replaceAll('\\', '/').toLowerCase();
const git = (cwd: string, args: string[], accepted = [0]) => {
  const result = spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, shell: false,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '.git', 'harborgit-test-empty-global'), GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' },
  });
  if (result.error) throw result.error;
  assert.ok(accepted.includes(result.status ?? -1), `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};
async function fixture(name = 'repo 中文 space') {
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(path.join(testRoot, 'harborgit-test-'));
  temporaryRoots.push(root);
  const repo = path.join(root, name);
  await mkdir(repo);
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', '--local', 'user.name', 'Harbor Test']);
  git(repo, ['config', '--local', 'user.email', 'harbor-test@example.invalid']);
  git(repo, ['config', '--local', 'core.autocrlf', 'false']);
  git(repo, ['config', '--local', 'commit.gpgsign', 'false']);
  return { root, repo };
}
async function seed(repo: string, content = 'base\n', file = 'shared.txt') {
  await writeFile(path.join(repo, file), content);
  git(repo, ['add', '--', file]);
  git(repo, ['commit', '-m', 'initial']);
}
async function conflicting() {
  const result = await fixture();
  await seed(result.repo);
  git(result.repo, ['switch', '-c', 'topic']);
  await writeFile(path.join(result.repo, 'shared.txt'), 'theirs\n');
  git(result.repo, ['commit', '-am', 'topic change']);
  git(result.repo, ['switch', 'main']);
  await writeFile(path.join(result.repo, 'shared.txt'), 'ours\n');
  git(result.repo, ['commit', '-am', 'main change']);
  const service = new GitService();
  await service.request('open', { path: result.repo });
  return { ...result, service };
}
const entry = (repo: Repository, file: string) => repo.entries.find(row => row.path === file);

test('project sessions isolate concurrent reads/writes, deduplicate paths, and reject closed sessions', async () => {
  const a = await fixture('project A 中文'), b = await fixture('project B');
  await seed(a.repo); await seed(b.repo);
  await writeFile(path.join(a.repo, 'only-A.txt'), 'A\n');
  await writeFile(path.join(b.repo, 'only-B.txt'), 'B\n');
  const manager = new Workspaces();
  const ra = await manager.request('open', { path: a.repo }, 'session-A');
  const rb = await manager.request('open', { path: b.repo }, 'session-B');
  assert.equal(ra.sessionId, 'session-A'); assert.equal(rb.sessionId, 'session-B');
  const results = await Promise.all([manager.request('stage', { paths: ['only-A.txt'] }, 'session-A'), manager.request('refresh', {}, 'session-B')]);
  assert.equal(entry(results[0], 'only-A.txt')?.index, 'A');
  assert.equal(entry(results[1], 'only-B.txt')?.worktree, '?');
  assert.equal(entry(results[1], 'only-A.txt'), undefined);
  assert.equal(git(b.repo, ['diff', '--cached', '--name-only']).trim(), '');
  const duplicate = await manager.request('open', { path: path.join(a.repo, '.git', '..') }, 'duplicate-A');
  assert.equal(duplicate.sessionId, 'session-A');
  manager.close('session-A');
  await assert.rejects(manager.request('refresh', {}, 'session-A'), /已关闭/);
  assert.equal((await manager.request('refresh', {}, 'session-B')).root, rb.root);
});

test('smart merge dev committed changes into master preserves source index, worktree, untracked files and branch', async () => {
  const { repo, root } = await fixture('dirty dev 中文'); await seed(repo, 'base\n');
  git(repo, ['branch', 'master']); git(repo, ['switch', '-c', 'dev']);
  await writeFile(path.join(repo, 'shared.txt'), 'committed dev\n'); git(repo, ['commit', '-am', 'dev committed']);
  const devHead = git(repo, ['rev-parse', 'HEAD']).trim();
  await writeFile(path.join(repo, 'shared.txt'), 'staged dev WIP\n'); git(repo, ['add', 'shared.txt']);
  await writeFile(path.join(repo, 'shared.txt'), 'unstaged dev WIP 中文\n');
  await writeFile(path.join(repo, 'untracked 中文 file.txt'), 'keep untracked\n');
  const before = { status: git(repo, ['status', '--porcelain=v2', '-z']), index: git(repo, ['diff', '--cached', '--binary']), worktree: git(repo, ['diff', '--binary']) };
  const service = new GitService({ mergeWorkspaceRoot: path.join(root, 'merge-workspaces') });
  await service.request('open', { path: repo });
  const result = await service.request('mergeInto', { target: 'master' });
  assert.equal(result.status, 'merged'); assert.equal(result.mergeRepository, null);
  assert.equal(git(repo, ['rev-parse', 'master']).trim(), devHead);
  assert.equal(git(repo, ['show', 'master:shared.txt']), 'committed dev\n');
  assert.equal(git(repo, ['branch', '--show-current']).trim(), 'dev');
  assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), before.status);
  assert.equal(git(repo, ['diff', '--cached', '--binary']), before.index);
  assert.equal(git(repo, ['diff', '--binary']), before.worktree);
  assert.equal(await readFile(path.join(repo, 'untracked 中文 file.txt'), 'utf8'), 'keep untracked\n');
  assert.equal(git(repo, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});

test('smart merge conflicts recover in another session; source WIP survives resolve/commit/cleanup', async () => {
  const { repo, root } = await fixture('conflicting dev'); await seed(repo);
  git(repo, ['branch', 'master']); git(repo, ['switch', 'master']);
  await writeFile(path.join(repo, 'shared.txt'), 'master commit\n'); git(repo, ['commit', '-am', 'master change']);
  git(repo, ['switch', '-c', 'dev', 'main']);
  await writeFile(path.join(repo, 'shared.txt'), 'dev commit\n'); git(repo, ['commit', '-am', 'dev change']);
  await writeFile(path.join(repo, 'shared.txt'), 'uncommitted dev must survive\n');
  const before = git(repo, ['status', '--porcelain=v2', '-z']);
  const manager = new Workspaces({ mergeWorkspaceRoot: path.join(root, 'merge-workspaces') });
  await manager.request('open', { path: repo }, 'dev-session');
  const result = await manager.request('mergeInto', { target: 'master' }, 'dev-session');
  assert.equal(result.status, 'attention');
  const recovery = result.mergeRepository!;
  assert.ok(recovery.sessionId); assert.equal(recovery.branch, 'master'); assert.equal(recovery.mergeInProgress, true);
  assert.equal(recovery.mergeWorkspace?.sourceBranch, 'dev');
  assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), before);
  assert.equal(await readFile(path.join(repo, 'shared.txt'), 'utf8'), 'uncommitted dev must survive\n');
  await assert.rejects(manager.request('finishMergeWorkspace', {}, recovery.sessionId), /先完成/);
  const conflict = await manager.request('conflict', { path: 'shared.txt' }, recovery.sessionId);
  assert.equal(conflict.ours, 'master commit\n'); assert.equal(conflict.theirs, 'dev commit\n');
  await manager.request('resolve', { path: 'shared.txt', choice: 'manual', content: 'merged commits only\n' }, recovery.sessionId);
  await manager.request('commit', { message: 'merge dev into master' }, recovery.sessionId);
  assert.equal(git(repo, ['show', 'master:shared.txt']), 'merged commits only\n');
  await manager.request('finishMergeWorkspace', {}, recovery.sessionId); manager.close(recovery.sessionId!);
  assert.equal(existsSync(recovery.root), false);
  assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), before);
});

test('smart merge conflict survives reopen; abort/cleanup leaves target and source unchanged', async () => {
  const { repo, root } = await conflicting();
  await writeFile(path.join(repo, 'untracked.txt'), 'preserved\n');
  const targetHead = git(repo, ['rev-parse', 'topic']).trim(), sourceHead = git(repo, ['rev-parse', 'HEAD']).trim();
  const service = new GitService({ mergeWorkspaceRoot: path.join(root, 'merge-workspaces') }); await service.request('open', { path: repo });
  const result = await service.request('mergeInto', { target: 'topic' });
  assert.ok(result.mergeRepository);
  const reopened = new GitService();
  const recovery = await reopened.request('open', { path: result.mergeRepository!.root });
  assert.equal(recovery.mergeWorkspace?.targetBranch, 'topic');
  await reopened.request('abortMerge', {}); await reopened.request('finishMergeWorkspace', {});
  assert.equal(git(repo, ['rev-parse', 'topic']).trim(), targetHead);
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), sourceHead);
  assert.equal(await readFile(path.join(repo, 'untracked.txt'), 'utf8'), 'preserved\n');
});

test('smart merge refuses target checked out in another worktree without modifying either tree', async () => {
  const { repo, root } = await fixture(); await seed(repo);
  git(repo, ['branch', 'master']); git(repo, ['switch', '-c', 'dev']);
  const other = path.join(root, 'master existing worktree'); git(repo, ['worktree', 'add', other, 'master']);
  await writeFile(path.join(other, 'shared.txt'), 'master WIP\n');
  const service = new GitService(); await service.request('open', { path: repo });
  await assert.rejects(service.request('mergeInto', { target: 'master' }), /另一个工作区/);
  assert.equal(await readFile(path.join(other, 'shared.txt'), 'utf8'), 'master WIP\n');
  assert.equal(git(repo, ['branch', '--show-current']).trim(), 'dev');
  git(repo, ['worktree', 'remove', '--force', other]); // Only this disposable fixture.
});

test('ordinary merge allows non-overlapping worktree changes and lets Git protect overlapping edits', async () => {
  const { repo } = await fixture(); await seed(repo); await writeFile(path.join(repo, 'local.txt'), 'base local\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'add local file']);
  git(repo, ['switch', '-c', 'dev']); await writeFile(path.join(repo, 'shared.txt'), 'dev commit\n'); git(repo, ['commit', '-am', 'dev']); git(repo, ['switch', 'main']);
  await writeFile(path.join(repo, 'local.txt'), 'my unsaved work\n');
  const service = new GitService(); await service.request('open', { path: repo });
  await service.request('merge', { branch: 'dev' });
  assert.equal(await readFile(path.join(repo, 'local.txt'), 'utf8'), 'my unsaved work\n');
  git(repo, ['switch', 'dev']); await writeFile(path.join(repo, 'shared.txt'), 'next dev\n'); git(repo, ['add', 'shared.txt']); git(repo, ['commit', '-m', 'next dev']); git(repo, ['switch', 'main']);
  await writeFile(path.join(repo, 'shared.txt'), 'overlapping local WIP\n');
  await assert.rejects(service.request('merge', { branch: 'dev' }));
  assert.equal(await readFile(path.join(repo, 'shared.txt'), 'utf8'), 'overlapping local WIP\n');
});

test.after(async () => {
  for (const root of temporaryRoots) {
    const resolved = path.resolve(root);
    const expected = testRoot + path.sep;
    assert.ok(resolved.startsWith(expected) && path.basename(resolved).startsWith('harborgit-test-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('unborn repository: literal Unicode/space/leading-dash/pathspec names, stage and unstage, initial history', async () => {
  const { repo } = await fixture();
  const service = new GitService();
  const opened = await service.request('open', { path: repo });
  assert.equal(clean(opened.root), clean(repo));
  assert.equal(opened.unborn, true);
  assert.equal(opened.branch, 'main');
  assert.deepEqual(await service.request('history', {}), []);
  const files = ['中文 文件.txt', '-leading.txt', '[ab].txt', 'a.txt'];
  for (const file of files) await writeFile(path.join(repo, file), `new ${file}\n`);
  assert.equal((await service.request('refresh', {})).entries.length, 4);
  const untracked = await service.request('diff', { path: files[0], area: 'worktree' });
  assert.match(untracked.text, /new 中文 文件/);
  const staged = await service.request('stage', { paths: ['[ab].txt'] });
  assert.equal(entry(staged, '[ab].txt')?.index, 'A');
  assert.notEqual(entry(staged, 'a.txt')?.index, 'A', 'literal pathspec must not match a.txt');
  const unstaged = await service.request('unstage', { paths: ['[ab].txt'] });
  assert.notEqual(entry(unstaged, '[ab].txt')?.index, 'A');
  await service.request('stage', { paths: files });
  const afterCommit = await service.request('commit', { message: '首次提交 中文\n\nbody detail' });
  assert.equal(afterCommit.unborn, false);
  assert.equal(afterCommit.entries.length, 0);
  const commits = await service.request('history', { limit: 10 });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, '首次提交 中文');
  assert.match(commits[0].body, /body detail/);
  const changed = await service.request('commitFiles', { hash: commits[0].hash });
  assert.deepEqual(changed.map(file => file.path).sort(), files.sort());
  const rootDiff = await service.request('diff', { path: '中文 文件.txt', area: 'commit', commit: commits[0].hash });
  assert.match(rootDiff.text, /\+new 中文 文件/);
});

test('workspace and index diffs remain distinct; deleting, renaming, and binary content are represented', async () => {
  const { repo } = await fixture();
  await seed(repo, 'one\n', '中文 文件.txt');
  const service = new GitService();
  await service.request('open', { path: repo });
  await writeFile(path.join(repo, '中文 文件.txt'), 'two\n');
  await service.request('stage', { paths: ['中文 文件.txt'] });
  await writeFile(path.join(repo, '中文 文件.txt'), 'three\n');
  const twoAreas = await service.request('refresh', {});
  assert.equal(entry(twoAreas, '中文 文件.txt')?.index, 'M');
  assert.equal(entry(twoAreas, '中文 文件.txt')?.worktree, 'M');
  assert.match((await service.request('diff', { path: '中文 文件.txt', area: 'index' })).text, /\+two/);
  assert.match((await service.request('diff', { path: '中文 文件.txt', area: 'worktree' })).text, /\+three/);
  await service.request('unstage', { paths: ['中文 文件.txt'] });
  assert.equal(entry(await service.request('refresh', {}), '中文 文件.txt')?.worktree, 'M');
  git(repo, ['restore', '--', '中文 文件.txt']);
  await rename(path.join(repo, '中文 文件.txt'), path.join(repo, 'renamed 空格.txt'));
  await service.request('stage', { paths: ['中文 文件.txt', 'renamed 空格.txt'] });
  const renamed = await service.request('refresh', {});
  assert.equal(entry(renamed, 'renamed 空格.txt')?.index, 'R');
  assert.equal(entry(renamed, 'renamed 空格.txt')?.originalPath, '中文 文件.txt');
  await service.request('commit', { message: 'rename file' });
  const renameCommit = (await service.request('history', {}))[0];
  const renameFiles = await service.request('commitFiles', { hash: renameCommit.hash });
  assert.ok(renameFiles.some(file => file.path === 'renamed 空格.txt' && file.status.startsWith('R') && file.oldPath === '中文 文件.txt'));
  await rm(path.join(repo, 'renamed 空格.txt'));
  await service.request('stage', { paths: ['renamed 空格.txt'] });
  assert.equal(entry(await service.request('refresh', {}), 'renamed 空格.txt')?.index, 'D');
  await writeFile(path.join(repo, 'binary.dat'), Buffer.from([0, 1, 2, 255, 0]));
  const binary = await service.request('diff', { path: 'binary.dat', area: 'worktree' });
  assert.equal(binary.binary, true);
});

test('branches: create, switch, reject unsafe deletion, safe deletion and invalid names', async () => {
  const { repo } = await fixture();
  await seed(repo);
  const service = new GitService();
  await service.request('open', { path: repo });
  await service.request('createBranch', { name: 'feature/中文' });
  assert.ok((await service.request('branches', {})).some(row => row.name === 'feature/中文'));
  await service.request('checkout', { name: 'feature/中文' });
  assert.equal((await service.request('refresh', {})).branch, 'feature/中文');
  await writeFile(path.join(repo, 'feature.txt'), 'new on feature\n');
  await service.request('stage', { paths: ['feature.txt'] });
  await service.request('commit', { message: 'feature only' });
  await service.request('checkout', { name: 'main' });
  await assert.rejects(service.request('deleteBranch', { name: 'feature/中文' }));
  assert.ok((await service.request('branches', {})).some(row => row.name === 'feature/中文'));
  await service.request('merge', { branch: 'feature/中文' });
  await service.request('deleteBranch', { name: 'feature/中文' });
  assert.ok(!(await service.request('branches', {})).some(row => row.name === 'feature/中文'));
  for (const name of ['--force', 'bad name', 'a..b']) await assert.rejects(service.request('createBranch', { name }));
});

test('clone and local bare remote: fetch/push/fast-forward pull; divergent pull rejects without merge', async () => {
  const { root, repo } = await fixture('source repo');
  await seed(repo);
  const remote = path.join(root, 'origin 裸仓库.git');
  await mkdir(remote);
  git(remote, ['init', '--bare', '--initial-branch=main']);
  git(repo, ['remote', 'add', 'origin', remote]);
  const source = new GitService();
  await source.request('open', { path: repo });
  await source.request('remote', { action: 'push', remote: 'origin', branch: 'main' });
  const clone = new GitService();
  const clonePath = path.join(root, 'clone 中文 with spaces');
  assert.equal((await clone.request('clone', { url: remote, destination: clonePath })).branch, 'main');
  await clone.request('identity', { name: 'Clone Test', email: 'clone@example.invalid' });
  git(clonePath, ['config', '--local', 'commit.gpgsign', 'false']);
  assert.equal((await clone.request('remotes', {}))[0].name, 'origin');
  await writeFile(path.join(repo, 'remote.txt'), 'from source\n');
  await source.request('stage', { paths: ['remote.txt'] });
  await source.request('commit', { message: 'source advance' });
  await source.request('remote', { action: 'push', remote: 'origin', branch: 'main' });
  const fetched = await clone.request('remote', { action: 'fetch', remote: 'origin' });
  assert.equal(fetched.behind, 1);
  const pulled = await clone.request('remote', { action: 'pull', remote: 'origin', branch: 'main' });
  assert.equal(pulled.behind, 0);
  assert.equal((await readFile(path.join(clonePath, 'remote.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'from source\n');
  await writeFile(path.join(repo, 'source-only.txt'), 'source diverges\n');
  await source.request('stage', { paths: ['source-only.txt'] });
  await source.request('commit', { message: 'source diverges' });
  await source.request('remote', { action: 'push', remote: 'origin', branch: 'main' });
  await writeFile(path.join(clonePath, 'clone-only.txt'), 'clone diverges\n');
  await clone.request('stage', { paths: ['clone-only.txt'] });
  const before = await clone.request('commit', { message: 'clone diverges' });
  await assert.rejects(clone.request('remote', { action: 'pull', remote: 'origin', branch: 'main' }));
  const after = await clone.request('refresh', {});
  assert.equal(after.head, before.head, 'ff-only failure must not silently merge or rebase');
  assert.equal(after.mergeInProgress, false);
  await assert.rejects(clone.request('remote', { action: 'push', remote: 'origin', branch: 'main' }));
  await assert.rejects(clone.request('remote', { action: 'fetch', remote: '--upload-pack=bad' }));
});

test('merge conflict: read base/ours/theirs, resolve ours, finish merge, inspect merge commit files/diff', async () => {
  const { service, repo } = await conflicting();
  await assert.rejects(service.request('merge', { branch: 'topic' }));
  const snapshot = await service.request('refresh', {});
  assert.equal(snapshot.mergeInProgress, true);
  assert.equal(entry(snapshot, 'shared.txt')?.conflict, true);
  const conflict = await service.request('conflict', { path: 'shared.txt' });
  assert.equal(conflict.base, 'base\n');
  assert.equal(conflict.ours, 'ours\n');
  assert.equal(conflict.theirs, 'theirs\n');
  assert.match(conflict.worktree, /<<<<<<< HEAD/);
  const resolved = await service.request('resolve', { path: 'shared.txt', choice: 'ours' });
  assert.ok(!resolved.entries.some(row => row.conflict));
  assert.equal(await readFile(path.join(repo, 'shared.txt'), 'utf8'), 'ours\n');
  await service.request('commit', { message: 'merge topic choosing ours' });
  assert.equal((await service.request('refresh', {})).mergeInProgress, false);
  const mergeCommit = (await service.request('history', { limit: 1 }))[0];
  assert.equal(mergeCommit.parents.length, 2);
  // Resolving with ours may yield an empty first-parent diff; the request must still succeed.
  assert.ok(Array.isArray(await service.request('commitFiles', { hash: mergeCommit.hash })));
  assert.equal((await service.request('diff', { path: 'shared.txt', area: 'commit', commit: mergeCommit.hash })).binary, false);
});

test('merge conflict: manual resolution and theirs resolution are staged, abort restores original head', async () => {
  const { service, repo } = await conflicting();
  await assert.rejects(service.request('merge', { branch: 'topic' }));
  await service.request('resolve', { path: 'shared.txt', choice: 'manual', content: 'manual 合并\n' });
  assert.equal(await readFile(path.join(repo, 'shared.txt'), 'utf8'), 'manual 合并\n');
  assert.match((await service.request('diff', { path: 'shared.txt', area: 'index' })).text, /\+manual 合并/);
  await service.request('abortMerge', {});
  assert.equal(await readFile(path.join(repo, 'shared.txt'), 'utf8'), 'ours\n');
  assert.equal((await service.request('refresh', {})).mergeInProgress, false);
  await assert.rejects(service.request('merge', { branch: 'topic' }));
  await service.request('resolve', { path: 'shared.txt', choice: 'theirs' });
  assert.equal(await readFile(path.join(repo, 'shared.txt'), 'utf8'), 'theirs\n');
  await service.request('commit', { message: 'merge topic choosing theirs' });
  const mergeCommit = (await service.request('history', { limit: 1 }))[0];
  const changed = await service.request('commitFiles', { hash: mergeCommit.hash });
  assert.ok(changed.some(row => row.path === 'shared.txt'));
  assert.match((await service.request('diff', { path: 'shared.txt', area: 'commit', commit: mergeCommit.hash })).text, /\+theirs/);
});

test('modify/delete conflict: choosing deleted side removes the file and stages resolution', async () => {
  const { repo } = await fixture();
  await seed(repo);
  git(repo, ['switch', '-c', 'delete-topic']);
  git(repo, ['rm', '--', 'shared.txt']);
  git(repo, ['commit', '-m', 'delete on topic']);
  git(repo, ['switch', 'main']);
  await writeFile(path.join(repo, 'shared.txt'), 'main modified\n');
  git(repo, ['commit', '-am', 'modify on main']);
  const service = new GitService();
  await service.request('open', { path: repo });
  await assert.rejects(service.request('merge', { branch: 'delete-topic' }));
  const conflict = await service.request('conflict', { path: 'shared.txt' });
  assert.equal(conflict.theirs, null);
  const resolved = await service.request('resolve', { path: 'shared.txt', choice: 'theirs' });
  assert.equal(existsSync(path.join(repo, 'shared.txt')), false);
  assert.ok(!resolved.entries.some(row => row.conflict));
  await service.request('commit', { message: 'resolve deletion' });
});

test('validation rejects escapes/options/invalid payloads, errors retain useful Git output, previous repo survives bad open', async () => {
  const { repo, root } = await fixture();
  await seed(repo);
  const service = new GitService();
  await service.request('open', { path: repo });
  for (const value of ['../outside.txt', '..\\outside.txt', '.git/config', 'a\0b', path.join(root, 'outside.txt')]) {
    await assert.rejects(service.request('stage', { paths: [value] }), `must reject ${JSON.stringify(value)}`);
  }
  await assert.rejects(service.request('commit', { message: '' }));
  await assert.rejects(service.request('diff', { path: 'shared.txt', area: 'commit', commit: '--output=oops' }));
  await assert.rejects(service.request('checkout', { name: '--orphan' }));
  await assert.rejects(service.request('open', { path: root }));
  assert.equal(clean((await service.request('refresh', {})).root), clean(repo));
  try {
    await service.request('checkout', { name: 'does-not-exist' });
    assert.fail('unknown branch must fail');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /branch|pathspec|invalid|分支|不存在|error|fatal/i);
  }
});

test('operation log reports commands and completion; a slow commit hook can be cancelled', async () => {
  const { repo } = await fixture();
  await seed(repo);
  const activities: Activity[] = [];
  let service: GitService;
  let cancelled = false;
  service = new GitService({
    onActivity: event => {
      activities.push(event);
      if (event.kind === 'start' && /\bcommit\b/.test(event.command)) {
        setTimeout(() => { cancelled = service.cancel(event.id); }, 300);
      }
    },
  });
  await service.request('open', { path: repo });
  await writeFile(path.join(repo, 'shared.txt'), 'slow commit\n');
  await service.request('stage', { paths: ['shared.txt'] });
  await writeFile(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nsleep 20\n', { mode: 0o755 });
  const start = Date.now();
  await assert.rejects(service.request('commit', { message: 'cancelled commit' }));
  assert.equal(cancelled, true);
  assert.ok(Date.now() - start < 12000, 'cancellation should interrupt the process tree promptly');
  assert.ok(activities.some(event => event.kind === 'start'));
  assert.ok(activities.some(event => event.kind === 'finish'));
  assert.equal((await service.request('history', {})).length, 1, 'cancelled hook must not produce a commit');
});

test('slow commit hook times out with a recoverable failure', async () => {
  const { repo } = await fixture();
  await seed(repo);
  const service = new GitService({ timeoutMs: 1800 });
  await service.request('open', { path: repo });
  await writeFile(path.join(repo, 'shared.txt'), 'timeout commit\n');
  await service.request('stage', { paths: ['shared.txt'] });
  await writeFile(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nsleep 20\n', { mode: 0o755 });
  const start = Date.now();
  await assert.rejects(service.request('commit', { message: 'timeout commit' }));
  assert.ok(Date.now() - start < 12000);
  await rm(path.join(repo, '.git', 'hooks', 'pre-commit'));
  assert.equal((await service.request('history', {})).length, 1);
  assert.equal((await service.request('commit', { message: 'retry after timeout' })).entries.length, 0);
});
