import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitError, GitService } from '../src/main/git-service';
import type { Activity } from '../src/shared/types';

// Playwright clears test-results on startup; repositories must live outside it.
const testRoot = fileURLToPath(new URL('../../../work/remote-integration', import.meta.url));
const git = (cwd: string, args: string[]) => {
  const result = spawnSync('git', args, { cwd, shell: false, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, 'empty-global') } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || 'Git fixture command failed'); return result.stdout.trim();
};
async function fixture(t: test.TestContext) {
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(path.join(testRoot, 'remote-'));
  t.after(async () => {
    assert.equal(path.dirname(root), testRoot);
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const repo = path.join(root, 'repo 中文'); await mkdir(repo);
  git(repo, ['init', '--initial-branch=main']);
  // Make the service independent of installed helpers and user identity.
  git(repo, ['config', '--local', 'credential.helper', '']);
  git(repo, ['config', '--local', 'user.name', 'Remote Test']);
  git(repo, ['config', '--local', 'user.email', 'remote@example.invalid']);
  const activities: Activity[] = [];
  const service = new GitService({ timeoutMs: 8000, onActivity: e => activities.push(e) });
  await service.request('open', { path: repo });
  return { root, repo, service, activities };
}

test('remote settings save offline, edit push URL, reject invalid input and remove only local configuration', async t => {
  const { root, repo, service, activities } = await fixture(t);
  const bare = path.join(root, '本地 remote.git'); await mkdir(bare); git(bare, ['init', '--bare', '--initial-branch=main']);
  await service.request('saveRemote', { create: true, name: 'origin', url: bare });
  assert.deepEqual(await service.request('remotes', {}), [{ name: 'origin', fetch: bare, push: bare }]);
  await service.request('remote', { action: 'fetch', remote: 'origin' });
  const url = 'https://example.invalid/owner/repo.git', pushUrl = 'git@example.invalid:owner/repo.git';
  await service.request('saveRemote', { create: false, name: 'origin', url, pushUrl });
  assert.deepEqual(await service.request('remotes', {}), [{ name: 'origin', fetch: url, push: pushUrl }]);
  await service.request('saveRemote', { create: false, name: 'origin', url });
  assert.equal((await service.request('remotes', {}))[0].push, url);
  await assert.rejects(service.request('saveRemote', { create: true, name: 'origin', url }), /已存在/);
  await assert.rejects(service.request('saveRemote', { create: false, name: 'origin', url: 'ext::bad' }), /无效/);
  await assert.rejects(service.request('saveRemote', { create: true, name: '--bad', url }), /无效/);
  await assert.rejects(service.request('saveRemote', { create: false, name: 'origin', url: 'https://user:secret@example.invalid/repo' }), /Token/);
  assert.equal((await service.request('remotes', {}))[0].fetch, url);
  assert.ok(!JSON.stringify(activities).includes('secret'));
  git(repo, ['config', '--local', '--add', 'remote.origin.pushurl', pushUrl]);
  git(repo, ['config', '--local', '--add', 'remote.origin.pushurl', 'git@example.invalid:other.git']);
  await assert.rejects(service.request('saveRemote', { create: false, name: 'origin', url: bare }), /多个地址/);
  assert.equal((await service.request('remotes', {}))[0].fetch, url);
  await service.request('removeRemote', { name: 'origin' });
  assert.deepEqual(await service.request('remotes', {}), []);
  assert.equal(git(bare, ['rev-parse', '--is-bare-repository']), 'true');
});

test('fetch and clone allow helper GUI authentication without terminal prompts and retain diagnostic output', async t => {
  const { root, repo, service } = await fixture(t);
  const capture = path.join(root, 'helper-env.txt').replaceAll('\\', '/');
  // Synthetic helper records only flags; no user credentials or network services are used.
  const helper = `!f() { if test "$1" = get; then printf '%s' "$GCM_INTERACTIVE|$GCM_GUI_PROMPT|$GIT_TERMINAL_PROMPT" > '${capture}'; fi; }; f`;
  git(repo, ['config', '--local', '--add', 'credential.helper', helper]);
  const server = createServer((_req, res) => { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="HarborGit fixture"' }); res.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/repo.git`;
  await service.request('saveRemote', { create: true, name: 'origin', url });
  const authFailure = (e: unknown) => {
    assert.ok(e instanceof GitError); assert.match(e.message, /认证失败/);
    assert.match(e.details.stderr || '', /terminal prompts disabled/); return true;
  };
  await assert.rejects(service.request('remote', { action: 'fetch', remote: 'origin' }), authFailure);
  assert.equal(await readFile(capture, 'utf8'), 'auto|true|0');
  // Clone starts outside the repo; use only the fixture's isolated config.
  const previous = { GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_COUNT = '0'; process.env.GIT_CONFIG_GLOBAL = path.join(repo, '.git', 'config'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    await rm(capture);
    await assert.rejects(new GitService({ timeoutMs: 8000 }).request('clone', { url, destination: path.join(root, 'clone') }), authFailure);
    assert.equal(await readFile(capture, 'utf8'), 'auto|true|0');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
