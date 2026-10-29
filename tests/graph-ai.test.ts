import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService } from '../src/main/git-service';
import { AiSettingsStore, generateMessage } from '../src/main/ai';
import { branchColors, branchHue, buildCommitGraph } from '../src/shared/commit-graph';
import type { Activity, AiSettingsInput, Commit, StagedSnapshot } from '../src/shared/types';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../work/graph-ai-tests');
const roots: string[] = [];
async function fixture() {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-ai-')); roots.push(root);
  const repo = path.join(root, 'repo 中文'); await mkdir(repo); git(repo, ['init', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Graph AI test'], ['user.email', 'test@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(repo, ['config', '--local', key, value]);
  return { root, repo };
}
function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '.git', 'empty-global') } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
async function commit(repo: string, file: string, value: string, message: string) { await writeFile(path.join(repo, file), value); git(repo, ['add', '--', file]); git(repo, ['commit', '-m', message]); return git(repo, ['rev-parse', 'HEAD']).trim(); }
async function httpFixture(handler: (request: IncomingMessage, response: ServerResponse, body: any) => void) {
  const server = createServer(async (request, response) => { const buffers = []; for await (const data of request) buffers.push(data); handler(request, response, JSON.parse(Buffer.concat(buffers).toString('utf8'))); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/v1`, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
const config: AiSettingsInput = { baseUrl: 'https://api.example.invalid/v1', model: 'fixture-model', protocol: 'responses', language: 'zh', style: 'conventional' };
const snap: StagedSnapshot = { tree: 'a'.repeat(40), files: [{ path: '中文 文件.txt', status: 'M' }], diff: '+staged content', truncated: false };

test.after(async () => { for (const root of roots) { const resolved = path.resolve(root); assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('harborgit-ai-')); await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } });

test('all-branch history exposes real merge parents, unmerged tips, topo order, pagination and unborn HEAD', async () => {
  const { repo } = await fixture(); await commit(repo, 'base.txt', 'root\n', 'initial');
  git(repo, ['switch', '-c', 'dev']); await commit(repo, 'dev.txt', 'dev\n', 'dev feature');
  git(repo, ['switch', 'main']); await commit(repo, 'main.txt', 'main\n', 'main feature'); git(repo, ['merge', '--no-ff', 'dev', '-m', 'merge dev']);
  git(repo, ['switch', '-c', 'unmerged']); const tip = await commit(repo, 'future.txt', 'future\n', 'future work'); git(repo, ['switch', 'main']);
  const service = new GitService(); await service.request('open', { path: repo });
  const all = await service.request('history', { scope: 'all' }), current = await service.request('history', { scope: 'current' });
  assert.ok(all.some(c => c.hash === tip)); assert.ok(!current.some(c => c.hash === tip));
  assert.equal(all.find(c => c.subject === 'merge dev')?.parents.length, 2);
  const indices = new Map(all.map((c, i) => [c.hash, i]));
  all.forEach((c, index) => c.parents.forEach(parent => { if (indices.has(parent)) assert.ok(indices.get(parent)! > index); }));
  const first = await service.request('history', { scope: 'all', limit: 2 }), second = await service.request('history', { scope: 'all', skip: 2, limit: 2 });
  assert.deepEqual([...first, ...second].map(c => c.hash), all.slice(0, 4).map(c => c.hash));
  const branches = await service.request('branches', {}), graph = buildCommitGraph(all, branches);
  const colors = branchColors(branches); assert.equal(new Set(colors.values()).size, branches.length); assert.deepEqual(branchColors([...branches].reverse()), colors);
  for (const c of all) assert.deepEqual(graph.rows.find(r => r.hash === c.hash)!.segments.filter(e => e.kind === 'parent').map(e => e.parent), c.parents);
  assert.equal(graph.continuations, 0); assert.ok(graph.laneCount >= 2);
  assert.notEqual(branchHue('main'), branchHue('dev'));
  const prefix = buildCommitGraph(all.slice(0, 2), branches); assert.deepEqual(prefix.rows, graph.rows.slice(0, 2)); assert.ok(prefix.continuations > 0);
  git(repo, ['switch', '--orphan', 'empty']);
  assert.deepEqual(await service.request('history', { scope: 'current' }), []);
  assert.equal((await service.request('history', { scope: 'all' })).length, all.length);
});

test('graph preserves octopus parent edges and never joins unrelated roots', () => {
  const c = (hash: string, parents: string[]): Commit => ({ hash, parents, shortHash: hash, author: '', email: '', date: '', subject: hash, body: '', refs: '' });
  const commits = [c('merge', ['one', 'two', 'three']), c('one', ['root']), c('two', ['root']), c('three', ['root']), c('root', []), c('unrelated', [])];
  const graph = buildCommitGraph(commits, []);
  assert.equal(graph.rows[0].merge, true); assert.equal(graph.rows[0].segments.filter(s => s.kind === 'parent').length, 3);
  assert.ok(graph.laneCount >= 3); assert.equal(graph.continuations, 0);
  assert.equal(graph.rows.at(-1)!.segments.length, 0);
});

test('AI snapshot includes only immutable staged content, rename metadata and binary notice; preserves working state', async () => {
  const { repo } = await fixture(); await commit(repo, '中文.txt', 'base\n', 'initial');
  await commit(repo, 'rename-me.txt', 'rename content\n', 'add rename source');
  await rename(path.join(repo, 'rename-me.txt'), path.join(repo, 'renamed 中文.txt')); git(repo, ['add', '-A', '--', 'rename-me.txt', 'renamed 中文.txt']);
  await writeFile(path.join(repo, '中文.txt'), 'STAGED_ONLY\n'); git(repo, ['add', '中文.txt']);
  await writeFile(path.join(repo, '中文.txt'), 'WORKTREE_SECRET_NOT_STAGED\n');
  await writeFile(path.join(repo, 'untracked.txt'), 'UNTRACKED_SECRET\n');
  await writeFile(path.join(repo, 'image.bin'), Buffer.from([0, 1, 2])); git(repo, ['add', 'image.bin']);
  const before = git(repo, ['status', '--porcelain=v2', '-z']);
  const service = new GitService(); await service.request('open', { path: repo });
  const snapshot = await service.request('stagedSnapshot', {});
  assert.match(snapshot.diff, /STAGED_ONLY/); assert.doesNotMatch(snapshot.diff, /WORKTREE_SECRET|UNTRACKED_SECRET/); assert.match(snapshot.diff, /Binary files/);
  assert.deepEqual(snapshot.files.map(f => f.path).sort(), ['image.bin', '中文.txt', 'renamed 中文.txt'].sort());
  assert.equal(snapshot.files.find(f => f.path === 'renamed 中文.txt')?.oldPath, 'rename-me.txt');
  assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), before);
  assert.equal(snapshot.tree, await service.request('stagedTree', {}));
  git(repo, ['reset', '--quiet', 'HEAD', '--', '.']);
  await assert.rejects(service.request('stagedSnapshot', {}), /暂存区为空/);
});

test('Responses and Chat protocols use configured endpoint/model, parse text, and never transmit credentials in payload', async () => {
  const requests: any[] = [];
  const server = await httpFixture((request, response, body) => {
    requests.push({ path: request.url, authorization: request.headers.authorization, body }); response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url?.endsWith('/responses') ? { output: [{ type: 'reasoning', content: [] }, { type: 'message', content: [{ type: 'output_text', text: 'feat: 更新中文功能' }] }] } : { choices: [{ message: { content: 'fix: 修复暂存改动' } }] }));
  });
  try {
    const responses = await generateMessage({ ...config, baseUrl: server.url, apiKey: 'dummy-test-key' }, snap, new AbortController().signal);
    assert.equal(responses, 'feat: 更新中文功能');
    assert.equal(requests[0].path, '/v1/responses'); assert.equal(requests[0].authorization, 'Bearer dummy-test-key'); assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.model, 'fixture-model'); assert.doesNotMatch(JSON.stringify(requests[0].body), /dummy-test-key/);
    assert.equal(JSON.parse(requests[0].body.input).diff, '+staged content');
    assert.equal(await generateMessage({ ...config, baseUrl: server.url, protocol: 'chat-completions' }, snap, new AbortController().signal), 'fix: 修复暂存改动');
    assert.equal(requests[1].path, '/v1/chat/completions'); assert.equal(requests[1].body.messages[0].role, 'system'); assert.match(requests[1].body.messages[0].content, /untrusted data/);
  } finally { await server.close(); }
});

test('AI provider reports HTTP/malformed/empty errors, redacts key, times out and supports cancellation', async () => {
  let mode = 'error';
  const server = await httpFixture((request, response) => {
    if (mode === 'slow') return;
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'error') { response.statusCode = 401; response.end(JSON.stringify({ error: { message: 'bad dummy-key' } })); }
    else response.end(mode === 'malformed' ? 'not-json' : '{}');
  });
  try {
    const options = { ...config, baseUrl: server.url, apiKey: 'dummy-key' };
    await assert.rejects(generateMessage(options, snap, new AbortController().signal), e => { assert.match(String(e), /401/); assert.doesNotMatch(String(e), /dummy-key/); return true; });
    mode = 'malformed'; await assert.rejects(generateMessage(options, snap, new AbortController().signal), /JSON/);
    mode = 'empty'; await assert.rejects(generateMessage(options, snap, new AbortController().signal), /有效提交消息/);
    mode = 'slow'; await assert.rejects(generateMessage(options, snap, new AbortController().signal, 80), /超时/);
    const controller = new AbortController(), task = generateMessage(options, snap, controller.signal); setTimeout(() => controller.abort(), 80); await assert.rejects(task, /取消/);
  } finally { await server.close(); }
});

test('settings keep key out of public responses/plaintext disk, and endpoint changes clear old credentials', async () => {
  const { root } = await fixture(), file = path.join(root, 'settings.json');
  const codec = { available: () => true, encrypt: (value: string) => Buffer.from(value.split('').reverse().join('')), decrypt: (value: Buffer) => value.toString().split('').reverse().join('') };
  const store = new AiSettingsStore(file, codec);
  const saved = await store.save({ ...config, apiKey: 'dummy-private-key' });
  assert.equal(saved.hasApiKey, true); assert.equal(saved.keyStorage, 'encrypted'); assert.doesNotMatch(JSON.stringify(saved), /dummy-private-key/);
  assert.doesNotMatch(await readFile(file, 'utf8'), /dummy-private-key/);
  const reopened = new AiSettingsStore(file, codec); assert.equal((await reopened.requestConfig()).apiKey, 'dummy-private-key');
  await reopened.save({ ...config, model: 'next' }); assert.equal((await reopened.requestConfig()).apiKey, 'dummy-private-key');
  await reopened.save({ ...config, baseUrl: 'https://another.example.invalid/v1' }); assert.equal((await reopened.get()).hasApiKey, false);
  const memory = new AiSettingsStore(path.join(root, 'memory.json'), { ...codec, available: () => false });
  assert.equal((await memory.save({ ...config, apiKey: 'memory-only-key' })).keyStorage, 'memory'); assert.doesNotMatch(await readFile(path.join(root, 'memory.json'), 'utf8'), /memory-only-key/);
  await assert.rejects(store.save({ ...config, baseUrl: 'https://host.invalid/v1?api_key=bad' }), /查询参数/);
});

test('generation marks changed index stale and cancellation leaves both index and commit history intact', async () => {
  const { repo } = await fixture(); await commit(repo, 'a.txt', 'base\n', 'initial'); await writeFile(path.join(repo, 'a.txt'), 'staged\n'); git(repo, ['add', 'a.txt']);
  const service = new GitService({ generateMessage: async snapshot => { assert.match(snapshot.diff, /staged/); await writeFile(path.join(repo, 'a.txt'), 'changed index\n'); git(repo, ['add', 'a.txt']); return 'feat: old snapshot'; } });
  await service.request('open', { path: repo }); assert.equal((await service.request('generateCommit', {})).stale, true);
  let cancellation = '';
  const slow = new GitService({ onActivity: event => { if (event.kind === 'start' && event.command.startsWith('AI ')) { cancellation = event.id; setTimeout(() => slow.cancel(event.id), 20); } }, generateMessage: (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) });
  await slow.request('open', { path: repo }); const before = git(repo, ['status', '--porcelain=v2', '-z']);
  await assert.rejects(slow.request('generateCommit', {}), /取消/); assert.ok(cancellation);
  assert.equal(git(repo, ['status', '--porcelain=v2', '-z']), before); assert.equal((await slow.request('history', {})).length, 1);
});
