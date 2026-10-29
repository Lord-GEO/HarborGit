import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.resolve(project, '../../work/ui-integration');
const screenshots = path.join(project, 'docs/screenshots');
const roots: string[] = [];
const apps = new Set<ElectronApplication>();

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true, env: {
    ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(cwd, '.git', 'harborgit-empty-test-global'), GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true',
  } });
  if (result.error) throw result.error;
  expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0);
  return result.stdout.trim();
}
async function fixture(name: string) {
  await mkdir(testRoot, { recursive: true }); await mkdir(screenshots, { recursive: true });
  const root = await mkdtemp(path.join(testRoot, 'harborgit-ui-')); roots.push(root);
  const repo = path.join(root, name); await mkdir(repo);
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', '--local', 'user.name', 'Harbor UI Test']);
  git(repo, ['config', '--local', 'user.email', 'ui-test@example.invalid']);
  git(repo, ['config', '--local', 'core.autocrlf', 'false']);
  git(repo, ['config', '--local', 'commit.gpgsign', 'false']);
  return { root, repo };
}
async function initial(repo: string, file = 'shared.txt', content = 'base\n') {
  await writeFile(path.join(repo, file), content); git(repo, ['add', '--', file]); git(repo, ['commit', '-m', 'chore: initialize repository']);
}
async function launch(root: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  env.HARBOR_USER_DATA = path.join(root, 'fresh-profile'); env.HARBOR_TEST_HIDDEN = '1';
  const executable = process.env.HARBOR_EXECUTABLE;
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [project], env, timeout: 45000 });
  apps.add(app);
  const page = await app.firstWindow();
  // Hidden native windows otherwise occasionally stop composing screenshots on Windows.
  // This instruments rendering for tests only; all Git actions below still go through UI.
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: '打开本地仓库', exact: true })).toBeVisible();
  return { app, page, errors };
}
async function close(app: ElectronApplication, errors: string[]) {
  expect(errors, 'renderer page errors').toEqual([]);
  await app.close(); apps.delete(app);
}
async function idle(page: Page) { await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled(); }
async function capture(app: ElectronApplication, filename: string) {
  // Show without taking focus so Windows composes the current DOM, rather than
  // reusing the last surface of a hidden native window. Restore hidden state after capture.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await new Promise(resolve => setTimeout(resolve, 150));
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const image = await window.webContents.capturePage(undefined, { stayAwake: true });
      if (image.isEmpty()) throw new Error('Native screenshot was empty');
      return image.toPNG().toString('base64');
    });
    await writeFile(path.join(screenshots, filename), Buffer.from(png, 'base64'));
  } finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide()); }
}
async function open(page: Page, repo: string) {
  await page.getByRole('button', { name: '打开本地仓库', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('仓库目录', { exact: true }).fill(repo);
  await dialog.getByRole('button', { name: '打开仓库', exact: true }).click();
  await expect(dialog).toBeHidden(); await idle(page);
  await expect.poll(async () => (await page.locator('.repo-location').textContent())?.replaceAll('\\', '/').toLowerCase()).toBe(repo.replaceAll('\\', '/').toLowerCase());
}
async function navigate(page: Page, name: string) { await idle(page); await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: name === '工作区' ? /^工作区/ : name, exact: name !== '工作区' }).click(); }
async function remote(page: Page, action: 'Fetch' | 'Pull' | 'Push') {
  await idle(page);
  await page.locator('.toolbar-buttons').getByRole('button', { name: action === 'Pull' ? '↓ Pull' : action, exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '执行操作', exact: true }).click();
  await expect(dialog).toBeHidden(); await idle(page);
  await expect(page.getByRole('status')).toContainText('远程操作完成');
}
async function commit(page: Page, message: string) {
  await page.getByLabel('提交信息', { exact: true }).fill(message);
  await page.getByRole('button', { name: /^提交到 / }).click();
  await expect(page.getByRole('status')).toContainText('提交成功'); await idle(page);
}

test.afterEach(async () => { for (const app of apps) { await app.close().catch(() => {}); apps.delete(app); } });
test.afterAll(async () => {
  for (const root of roots) {
    const resolved = path.resolve(root);
    expect(resolved.startsWith(testRoot + path.sep) && path.basename(resolved).startsWith('harborgit-ui-')).toBeTruthy();
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('desktop UI: open → diff → stage → unstage → commit → history; create/switch/delete branch', async () => {
  const { root, repo } = await fixture('harbor-demo 中文仓库');
  await mkdir(path.join(repo, 'src')); await mkdir(path.join(repo, 'docs'));
  const oldCode = ["export const product = 'HarborGit';", '', 'export function greet(name: string) {', '  return `Hello, ${name}`;', '}', ''].join('\n');
  await initial(repo, 'README.md', '# HarborGit demo\n\nA calm place for every change.\n');
  await writeFile(path.join(repo, 'src/欢迎.ts'), oldCode);
  await writeFile(path.join(repo, 'docs/roadmap.md'), '# Roadmap\n- Build something useful\n');
  git(repo, ['add', '--', 'src/欢迎.ts', 'docs/roadmap.md']); git(repo, ['commit', '-m', 'feat: add greeting and roadmap']);
  await writeFile(path.join(repo, 'src/欢迎.ts'), oldCode.replace('Hello, ${name}', '欢迎靠岸，${name}').replace('greet(name: string)', "greet(name: string = '朋友')") + '\nexport const supportedLanguages = [\'中文\', \'English\'];\n');
  await writeFile(path.join(repo, 'README.md'), '# HarborGit demo\n\n把每次改动，稳稳靠岸。\n\n- Workspace and index\n- Clear file diffs\n');
  await writeFile(path.join(repo, 'docs/notes 中文.md'), '# Today\nEvery small commit counts.\n');
  const { app, page, errors } = await launch(root);
  await open(page, repo);
  await page.getByRole('button', { name: '工作区 src/欢迎.ts', exact: true }).click();
  await expect(page.getByLabel('差异内容', { exact: true })).toContainText('欢迎靠岸');
  expect(await page.locator('.diff-table .added').count()).toBeGreaterThan(2);
  await capture(app, 'changes.png');
  await page.getByRole('button', { name: '暂存 src/欢迎.ts', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂存区 src/欢迎.ts', exact: true })).toBeVisible(); await idle(page);
  await page.getByRole('button', { name: '取消暂存 src/欢迎.ts', exact: true }).click();
  await expect(page.getByRole('button', { name: '工作区 src/欢迎.ts', exact: true })).toBeVisible(); await idle(page);
  await page.getByRole('button', { name: '暂存 src/欢迎.ts', exact: true }).click(); await idle(page);
  const message = 'feat: 用中文问候每位访问者'; await commit(page, message);
  expect(git(repo, ['log', '-1', '--format=%s'])).toBe(message);
  expect(git(repo, ['diff', '--cached', '--name-only'])).toBe('');
  await navigate(page, '提交历史');
  await page.getByRole('button', { name: `查看提交 ${message}`, exact: true }).click();
  await expect(page.locator('.history-files')).toContainText('src/欢迎.ts');
  await expect(page.getByLabel('差异内容', { exact: true })).toContainText('欢迎靠岸');
  await capture(app, 'history.png');
  await navigate(page, '分支管理');
  await page.getByRole('button', { name: '创建分支', exact: true }).click();
  const create = page.getByRole('dialog'); await create.getByLabel('新分支名称', { exact: true }).fill('feature/ui-flow');
  await create.getByRole('button', { name: '创建并切换', exact: true }).click(); await expect(create).toBeHidden(); await idle(page);
  await expect(page.locator('.current-branch')).toContainText('feature/ui-flow');
  const main = page.locator('.branch-row').filter({ has: page.locator('.branch-info > strong', { hasText: /^main/ }) });
  await main.getByRole('button', { name: '切换', exact: true }).click(); await idle(page);
  await expect(page.locator('.current-branch')).toContainText('main');
  await capture(app, 'branches.png');
  const feature = page.locator('.branch-row').filter({ has: page.locator('.branch-info > strong', { hasText: /^feature\/ui-flow/ }) });
  await feature.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden(); await idle(page); await expect(feature).toHaveCount(0);
  expect(git(repo, ['branch', '--list', 'feature/ui-flow'])).toBe('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await close(app, errors);
});

test('desktop UI: clone local bare remote → fetch → pull → stage/commit → push', async () => {
  const { root, repo } = await fixture('source remote actor'); await initial(repo);
  const origin = path.join(root, 'origin 本地裸仓库.git'); await mkdir(origin); git(origin, ['init', '--bare', '--initial-branch=main']);
  git(repo, ['remote', 'add', 'origin', origin]); git(repo, ['push', '--set-upstream', 'origin', 'main']);
  const destination = path.join(root, 'cloned 中文仓库'); const { app, page, errors } = await launch(root);
  await page.getByRole('button', { name: '克隆仓库', exact: true }).click();
  const clone = page.getByRole('dialog'); await clone.getByLabel('仓库地址', { exact: true }).fill(origin);
  await clone.getByLabel('克隆目标目录', { exact: true }).fill(destination);
  await clone.getByRole('button', { name: '开始克隆', exact: true }).click(); await expect(clone).toBeHidden(); await idle(page);
  await page.getByRole('button', { name: '提交身份', exact: true }).click();
  const identity = page.getByRole('dialog'); await identity.getByLabel('提交者姓名', { exact: true }).fill('Harbor UI Clone');
  await identity.getByLabel('提交者邮箱', { exact: true }).fill('ui-clone@example.invalid');
  await identity.getByRole('button', { name: '保存身份', exact: true }).click(); await expect(identity).toBeHidden(); await idle(page);
  git(destination, ['config', '--local', 'commit.gpgsign', 'false']);
  await writeFile(path.join(repo, 'remote.txt'), 'A change from the other workstation.\n');
  git(repo, ['add', '--', 'remote.txt']); git(repo, ['commit', '-m', 'feat: add remote file']); git(repo, ['push', 'origin', 'main']);
  await remote(page, 'Fetch'); await expect(page.locator('.sync-summary')).toContainText('↓ 1');
  await remote(page, 'Pull');
  expect((await readFile(path.join(destination, 'remote.txt'), 'utf8')).replaceAll('\r\n', '\n')).toContain('other workstation');
  await writeFile(path.join(destination, '本地 推送.txt'), 'This commit was created in the graphical client.\n');
  await page.getByRole('button', { name: '刷新仓库', exact: true }).click(); await idle(page);
  await page.getByRole('button', { name: '暂存 本地 推送.txt', exact: true }).click(); await idle(page);
  await commit(page, 'feat: push a commit from HarborGit'); await remote(page, 'Push');
  expect(git(origin, ['rev-parse', 'refs/heads/main'])).toBe(git(destination, ['rev-parse', 'HEAD']));
  await expect(page.locator('.sync-summary')).toContainText('↑ 0');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await close(app, errors);
});

test('desktop UI: merge conflicting branch → compare base/ours/theirs → manual resolution → merge commit', async () => {
  const { root, repo } = await fixture('conflict 合并演示');
  await initial(repo, 'shared.txt', 'title: HarborGit\nmessage: original\nstatus: ready\n');
  git(repo, ['switch', '-c', 'feature/welcome']);
  await writeFile(path.join(repo, 'shared.txt'), 'title: HarborGit\nmessage: welcome aboard\nstatus: ready\n'); git(repo, ['commit', '-am', 'feat: welcome aboard']);
  git(repo, ['switch', 'main']);
  await writeFile(path.join(repo, 'shared.txt'), 'title: HarborGit\nmessage: 你好，世界\nstatus: ready\n'); git(repo, ['commit', '-am', 'feat: greet in Chinese']);
  const { app, page, errors } = await launch(root); await open(page, repo); await navigate(page, '分支管理');
  const topic = page.locator('.branch-row').filter({ has: page.locator('.branch-info > strong', { hasText: /^feature\/welcome/ }) });
  await topic.getByRole('button', { name: '合并到当前', exact: true }).click();
  await expect(page.locator('.merge-banner')).toContainText('1 个冲突待解决'); await idle(page);
  await expect(page.getByRole('alert')).toContainText('CONFLICT');
  await navigate(page, '工作区');
  await page.getByRole('button', { name: '解决冲突 shared.txt', exact: true }).click();
  const editor = page.getByRole('dialog'); await expect(editor.locator('.conflict-columns')).toContainText('你好，世界');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await expect(editor.locator('.conflict-columns')).toContainText('welcome aboard');
  await editor.getByText('查看共同祖先 Base', { exact: true }).click(); await expect(editor.locator('.base-version')).toContainText('message: original');
  const merged = 'title: HarborGit\nmessage: 你好，世界 · Welcome aboard\nstatus: ready\n';
  await editor.getByLabel('冲突合并结果', { exact: true }).fill(merged);
  await capture(app, 'conflict.png');
  await editor.getByRole('button', { name: '保存合并结果并暂存', exact: true }).click(); await expect(editor).toBeHidden(); await idle(page);
  await expect(page.locator('.merge-banner')).toContainText('所有冲突已解决');
  await expect(page.getByRole('button', { name: '暂存区 shared.txt', exact: true })).toBeVisible();
  await commit(page, 'merge: combine Chinese and English greeting');
  expect(await readFile(path.join(repo, 'shared.txt'), 'utf8')).toBe(merged);
  expect(git(repo, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ')).toHaveLength(3);
  await expect(page.locator('.merge-banner')).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
  await close(app, errors);
});
