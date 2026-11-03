import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitError, GitService } from '../src/main/git-service';
import type { Activity } from '../src/shared/types';

const base = path.resolve(fileURLToPath(new URL('../../../work/tag-integration', import.meta.url)));
process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_CONFIG_GLOBAL = path.join(base, 'no-global-config'); process.env.GIT_CONFIG_COUNT = '0';
function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(t: test.TestContext) {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-tags-'));
  t.after(async () => { assert.equal(path.dirname(root), base); assert.ok(path.basename(root).startsWith('harborgit-tags-')); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const repo = path.join(root, '项目 中文 space'), bare = path.join(root, '远程 release.git'); await mkdir(repo); await mkdir(bare);
  git(repo, ['init', '--initial-branch=main']); git(bare, ['init', '--bare', '--initial-branch=main']);
  for (const [key, value] of [['user.name', 'Tag Test'], ['user.email', 'tags@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgSign', 'false'], ['core.autocrlf', 'false']]) git(repo, ['config', '--local', key, value]);
  await writeFile(path.join(repo, '文件 中文.txt'), 'original\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'initial']); const first = git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, '文件 中文.txt'), 'committed\n'); git(repo, ['commit', '-am', 'second']); const head = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['remote', 'add', 'release', bare]);
  const activities: Activity[] = [], service = new GitService({ onActivity: e => activities.push(e) }); await service.request('open', { path: repo });
  return { root, repo, bare, service, activities, first, head };
}
function state(repo: string) { return { head: git(repo, ['rev-parse', 'HEAD']), index: git(repo, ['write-tree']), status: git(repo, ['status', '--porcelain=v1', '-z']), worktree: git(repo, ['diff', '--binary']), staged: git(repo, ['diff', '--cached', '--binary']) }; }

test('tags: annotated historical target and lightweight HEAD preserve staged, unstaged and untracked Unicode files', async t => {
  const { repo, service, first, head } = await fixture(t);
  await writeFile(path.join(repo, '文件 中文.txt'), 'staged\n'); git(repo, ['add', '.']); await writeFile(path.join(repo, '文件 中文.txt'), 'working\n'); await writeFile(path.join(repo, '未跟踪.txt'), 'private\n');
  const before = state(repo); git(repo, ['config', 'tag.gpgSign', 'true']);
  await service.request('createTag', { name: '发布/v1.7.0', targetCommit: first, kind: 'annotated', message: '版本说明\n\n中文内容\n' });
  await service.request('createTag', { name: 'v-next', targetCommit: head, kind: 'lightweight' });
  assert.deepEqual(state(repo), before); assert.equal(await readFile(path.join(repo, '未跟踪.txt'), 'utf8'), 'private\n');
  assert.equal(git(repo, ['cat-file', '-t', 'refs/tags/发布/v1.7.0']), 'tag'); assert.equal(git(repo, ['rev-parse', 'refs/tags/发布/v1.7.0^{commit}']), first);
  assert.equal(git(repo, ['cat-file', '-t', 'refs/tags/v-next']), 'commit'); assert.equal(git(repo, ['rev-parse', 'refs/tags/v-next']), head);
  assert.match(git(repo, ['cat-file', '-p', 'refs/tags/发布/v1.7.0']), /版本说明\n\n中文内容/);
  const tags = await service.request('tags', {}); assert.equal(tags.length, 2);
  const annotated = tags.find(tag => tag.name === '发布/v1.7.0')!; assert.equal(annotated.kind, 'annotated'); assert.equal(annotated.target, first); assert.equal(annotated.targetType, 'commit'); assert.notEqual(annotated.objectId, first);
  assert.ok((await service.request('history', { scope: 'all' })).find(commit => commit.hash === first)?.refs.includes('refs/tags/发布/v1.7.0'));
});

test('tags: duplicate, malformed, option-like names, invalid target and empty annotation fail without moving tags or files', async t => {
  const { repo, service, head } = await fixture(t); const before = state(repo);
  await service.request('createTag', { name: 'v-stable', targetCommit: head, kind: 'lightweight' });
  for (const name of ['--force', 'bad name', 'bad..name', 'bad.lock', 'bad/.name', 'bad@{x}', 'bad\nname']) await assert.rejects(service.request('createTag', { name, targetCommit: head, kind: 'lightweight' }), /无效/);
  await assert.rejects(service.request('createTag', { name: 'v-stable', targetCommit: head, kind: 'lightweight' }), /已存在/);
  await assert.rejects(service.request('createTag', { name: 'empty', targetCommit: head, kind: 'annotated', message: '  ' }), /说明/);
  await assert.rejects(service.request('createTag', { name: 'invalid-target', targetCommit: '--all', kind: 'lightweight' }), /无效/);
  assert.equal((await service.request('tags', {})).length, 1); assert.deepEqual(state(repo), before);
});

test('tags: explicit push sends only selected annotated tag despite followTags and mirror configuration; repeat is safe', async t => {
  const { repo, bare, service, first, head, activities } = await fixture(t);
  await service.request('createTag', { name: 'v-other', targetCommit: head, kind: 'annotated', message: 'not selected' });
  await service.request('createTag', { name: '发布/已选', targetCommit: first, kind: 'annotated', message: 'selected' });
  const tag = (await service.request('tags', {})).find(tag => tag.name === '发布/已选')!;
  git(repo, ['config', 'push.followTags', 'true']); git(repo, ['config', 'remote.release.mirror', 'true']);
  const before = state(repo);
  await service.request('pushTag', { name: tag.name, remote: 'release', expectedObjectId: tag.objectId });
  await service.request('pushTag', { name: tag.name, remote: 'release', expectedObjectId: tag.objectId });
  assert.equal(git(bare, ['for-each-ref', '--format=%(refname)']), `refs/tags/${tag.name}`);
  assert.equal(git(bare, ['rev-parse', `refs/tags/${tag.name}`]), tag.objectId); assert.equal(git(bare, ['rev-parse', `refs/tags/${tag.name}^{commit}`]), first);
  assert.deepEqual(state(repo), before); assert.ok(activities.some(e => e.command.includes('--no-follow-tags') && e.command.includes('--no-mirror')));
});

test('tags: lightweight push works and remote rejection never overwrites existing tag', async t => {
  const { repo, bare, service, first, head } = await fixture(t);
  await service.request('createTag', { name: 'release', targetCommit: first, kind: 'lightweight' });
  await service.request('pushTag', { name: 'release', remote: 'release', expectedObjectId: first });
  git(repo, ['tag', '-f', 'release', head]);
  await assert.rejects(service.request('pushTag', { name: 'release', remote: 'release', expectedObjectId: head }), (error: unknown) => { assert.ok(error instanceof GitError); assert.match(error.details.stderr!, /already exists|rejected/); return true; });
  assert.equal(git(bare, ['rev-parse', 'refs/tags/release']), first); assert.equal(git(repo, ['rev-parse', 'refs/tags/release']), head);
});

test('tags: stale push confirmation and unknown remote are rejected before any push', async t => {
  const { repo, bare, service, first, head, activities } = await fixture(t);
  await service.request('createTag', { name: 'moved', targetCommit: first, kind: 'lightweight' }); git(repo, ['tag', '-f', 'moved', head]);
  await assert.rejects(service.request('pushTag', { name: 'moved', remote: 'release', expectedObjectId: first }), /修改或删除/);
  git(repo, ['tag', '-d', 'moved']); await assert.rejects(service.request('pushTag', { name: 'moved', remote: 'release', expectedObjectId: head }), /修改或删除/);
  await assert.rejects(service.request('pushTag', { name: 'missing', remote: 'unknown', expectedObjectId: head }), /远程仓库不存在/);
  await assert.rejects(service.request('pushTag', { name: 'missing', remote: 'release', expectedObjectId: head.slice(0, 7) }), /无效/);
  assert.equal(git(bare, ['for-each-ref']), ''); assert.ok(!activities.some(e => e.kind === 'start' && / push /.test(e.command)));
});

test('tags: detached HEAD can tag a committed version; non-commit existing tags remain visible', async t => {
  const { repo, service, first } = await fixture(t); git(repo, ['switch', '--detach', first]);
  await service.request('createTag', { name: 'detached', targetCommit: first, kind: 'lightweight' });
  const blob = git(repo, ['rev-parse', 'HEAD:文件 中文.txt']); git(repo, ['tag', 'blob-object', blob]);
  const tags = await service.request('tags', {}); assert.equal(tags.find(tag => tag.name === 'blob-object')?.targetType, 'blob');
  await assert.rejects(service.request('createTag', { name: 'not-a-commit', targetCommit: blob, kind: 'lightweight' }));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), first);
});

test('tags: long-running remote timeout leaves remote unchanged and reports cancellation', async t => {
  const { repo, bare, service, head } = await fixture(t);
  await service.request('createTag', { name: 'slow', targetCommit: head, kind: 'lightweight' });
  await writeFile(path.join(bare, 'hooks/pre-receive'), '#!/bin/sh\nsleep 20\n', { mode: 0o755 });
  const timed = new GitService({ timeoutMs: 1600 }); await timed.request('open', { path: repo });
  await assert.rejects(timed.request('pushTag', { name: 'slow', remote: 'release', expectedObjectId: head }), (error: unknown) => { assert.ok(error instanceof GitError); assert.match(error.message, /超时/); assert.equal(error.details.cancelled, true); return true; });
  assert.equal(git(bare, ['for-each-ref']), ''); assert.equal(git(repo, ['rev-parse', 'HEAD']), head);
});

test('tags: multiple push URLs are rejected before network activity', async t => {
  const { repo, bare, service, head, activities } = await fixture(t);
  await service.request('createTag', { name: 'single-destination', targetCommit: head, kind: 'lightweight' });
  git(repo, ['config', '--add', 'remote.release.pushurl', bare]); git(repo, ['config', '--add', 'remote.release.pushurl', path.join(path.dirname(bare), 'other.git')]);
  await assert.rejects(service.request('pushTag', { name: 'single-destination', remote: 'release', expectedObjectId: head }), /多个推送地址/);
  assert.ok(!activities.some(e => e.kind === 'start' && / push /.test(e.command))); assert.equal(git(bare, ['for-each-ref']), '');
});

test('tags: user cancellation stops a long-running push and retains local tag', async t => {
  const { repo, bare, service, head } = await fixture(t);
  await service.request('createTag', { name: 'cancel', targetCommit: head, kind: 'lightweight' });
  await writeFile(path.join(bare, 'hooks/pre-receive'), '#!/bin/sh\nsleep 20\n', { mode: 0o755 });
  const cancellable = new GitService({ onActivity: event => {
    if (event.kind === 'start' && / push /.test(event.command)) setTimeout(() => cancellable.cancel(event.id), 500);
  } });
  await cancellable.request('open', { path: repo });
  await assert.rejects(cancellable.request('pushTag', { name: 'cancel', remote: 'release', expectedObjectId: head }), (error: unknown) => { assert.ok(error instanceof GitError); assert.equal(error.details.cancelled, true); assert.match(error.message, /已取消/); return true; });
  assert.equal(git(bare, ['for-each-ref']), ''); assert.equal(git(repo, ['rev-parse', 'refs/tags/cancel']), head);
});
