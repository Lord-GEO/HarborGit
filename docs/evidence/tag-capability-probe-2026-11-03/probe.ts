import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { GitService } from '../../../src/main/git-service';

async function main() {
  const project = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const parent = path.resolve(project, '../../work/tag-capability-probe'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'harborgit-tag-probe-'));
  const repo = path.join(root, '仓库 中文 space'), remote = path.join(root, '本地 remote.git'); await mkdir(repo);
  process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_CONFIG_GLOBAL = path.join(root, 'fixture-no-global');
  process.env.GIT_TERMINAL_PROMPT = '0';
  function git(cwd: string, args: string[]) {
    const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: process.env });
    if (result.error) throw result.error; assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  }
  try {
    git(repo, ['init', '--initial-branch=main']); git(root, ['init', '--bare', '--initial-branch=main', remote]);
    for (const [key, value] of [['user.name', 'Tag Capability QA'], ['user.email', 'tag-probe@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgSign', 'false'], ['push.gpgSign', 'false'], ['push.followTags', 'false']]) git(repo, ['config', key, value]);
    await writeFile(path.join(repo, '说明.txt'), 'tag capability probe\n'); git(repo, ['add', '--', '说明.txt']); git(repo, ['commit', '-m', 'dedicated tag probe']);
    git(repo, ['remote', 'add', 'origin', remote]); git(repo, ['tag', '-a', 'v-proof-annotated', '-m', 'annotated fixture']); git(repo, ['tag', 'v-proof-lightweight']);
    const commands: string[] = [], service = new GitService({ onActivity: event => { if (event.kind === 'start' && /git push /.test(event.command)) commands.push(event.command.replaceAll(root, '<dedicated-fixture>')); } });
    await service.request('open', { path: repo });
    const history = await service.request('history', { scope: 'all' });
    assert.ok(history[0].refs.includes('tag: refs/tags/v-proof-annotated') && history[0].refs.includes('tag: refs/tags/v-proof-lightweight'));
    const unsupported: Record<string, string> = {};
    for (const operation of ['createTag', 'pushTag']) {
      try { await service.request(operation as never, { name: 'v-unsupported', remote: 'origin' } as never); assert.fail('Unsupported operation unexpectedly succeeded'); }
      catch (error) { assert.ok(error instanceof Error && error.message.includes('不支持')); unsupported[operation] = error.message; }
    }
    const remoteTags = () => git(remote, ['for-each-ref', '--format=%(refname)', 'refs/tags']).split('\n').filter(Boolean);
    await service.request('remote', { action: 'push', remote: 'origin' }); const defaultPush = remoteTags(); assert.deepEqual(defaultPush, []);
    git(repo, ['config', 'push.followTags', 'true']);
    await service.request('remote', { action: 'push', remote: 'origin' }); const configuredPush = remoteTags(); assert.deepEqual(configuredPush, ['refs/tags/v-proof-annotated']);
    assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), git(repo, ['rev-parse', 'HEAD']));
    const result = { date: '2026-11-03', version: '1.6.2', scope: 'Dedicated local worktree and bare repository only; system/global Git configuration disabled.', gitVersion: git(repo, ['--version']), historyRefs: history[0].refs, unsupported, pushFollowTagsFalse: defaultPush, pushFollowTagsTrue: configuredPush, pushCommands: commands, conclusion: 'No tag creation/push API. History exposes tag decorations. Default GUI branch push sends no tags, but inherited push.followTags=true adds reachable annotated tags, not lightweight tags.' };
    await writeFile(path.join(project, 'docs/verification-tags-2026-11-03.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    assert.ok(root.startsWith(parent + path.sep) && path.basename(root).startsWith('harborgit-tag-probe-'));
    await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
}
main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
