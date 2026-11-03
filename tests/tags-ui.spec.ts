import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = path.resolve(project, '../../work/tags-ui');
const roots: string[] = [], apps = new Set<ElectronApplication>();
function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global-config'), GIT_CONFIG_COUNT: '0' } });
  if (result.error) throw result.error; expect(result.status, result.stderr).toBe(0); return result.stdout.trim();
}
async function fixture() {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-tags-ui-')); roots.push(root);
  const repo = path.join(root, '标签 中文 space'), bare = path.join(root, '本地 远程.git'); await mkdir(repo); await mkdir(bare);
  git(repo, ['init', '--initial-branch=main']); git(bare, ['init', '--bare', '--initial-branch=main']);
  for (const [key, value] of [['user.name', 'Tags UI'], ['user.email', 'tags-ui@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['tag.gpgSign', 'false'], ['push.followTags', 'true']]) git(repo, ['config', key, value]);
  await writeFile(path.join(repo, '中文 文件.txt'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'first release']); const first = git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, '中文 文件.txt'), 'feature\n'); git(repo, ['commit', '-am', 'second release']); const head = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['remote', 'add', 'release', bare]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value;
  Object.assign(env, { HARBOR_USER_DATA: path.join(root, 'profile'), HARBOR_TEST_HIDDEN: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global-config'), GIT_CONFIG_COUNT: '0' });
  const executable = process.env.HARBOR_EXECUTABLE;
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [project], env, timeout: 45000 }); apps.add(app);
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.getByRole('button', { name: '打开本地仓库', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('仓库目录', { exact: true }).fill(repo); await dialog.getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  return { root, repo, bare, first, head, app, page, errors };
}
async function idle(page: Page) { await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled(); }
async function navigate(page: Page, name: string) { await idle(page); await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click(); }
async function capture(app: ElectronApplication, name: string) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  try {
    const page = await app.firstWindow(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await new Promise(resolve => setTimeout(resolve, 180));
    const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true })).toPNG().toString('base64'));
    await writeFile(path.join(project, 'docs/screenshots', name), Buffer.from(bytes, 'base64'));
  } finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide()); }
}
async function close(app: ElectronApplication, errors: string[]) { expect(errors).toEqual([]); await app.close(); apps.delete(app); }
test.afterEach(async () => { for (const app of apps) { await app.close().catch(() => {}); apps.delete(app); } });
test.afterAll(async () => { for (const root of roots) { expect(path.dirname(root)).toBe(base); expect(path.basename(root).startsWith('harborgit-tags-ui-')).toBe(true); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } });

test('tags UI: create on selected history commit, retain dirty index, create lightweight HEAD and push only selected tag', async () => {
  const { repo, bare, first, head, app, page, errors } = await fixture();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 720 }));
  await writeFile(path.join(repo, '中文 文件.txt'), 'staged\n'); git(repo, ['add', '.']); await writeFile(path.join(repo, '中文 文件.txt'), 'unstaged\n'); await writeFile(path.join(repo, '未跟踪.txt'), 'private\n');
  const before = { index: git(repo, ['write-tree']), status: git(repo, ['status', '--porcelain', '-z']) };
  await navigate(page, '提交历史'); await page.getByRole('button', { name: '查看提交 first release', exact: true }).click();
  await page.getByRole('button', { name: '给所选提交创建标签', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '创建标签', exact: true }); await expect(dialog).toContainText(first);
  await dialog.getByLabel('标签名称', { exact: true }).fill('发布/v1.7.0'); await dialog.getByLabel('标签说明', { exact: true }).fill('标签功能上线\n\n保留本地工作进度');
  await dialog.getByRole('button', { name: '创建标签', exact: true }).scrollIntoViewIfNeeded();
  await capture(app, 'v1.7-tag-create-dark.png'); await dialog.getByRole('button', { name: '创建标签', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  await expect(page.getByRole('article', { name: '标签 发布/v1.7.0', exact: true })).toBeVisible();
  expect(git(repo, ['rev-parse', 'refs/tags/发布/v1.7.0^{commit}'])).toBe(first);
  await page.getByRole('button', { name: '＋ 新建标签', exact: true }).click(); dialog = page.getByRole('dialog', { name: '创建标签', exact: true });
  await expect(dialog).toContainText(head); await dialog.getByLabel('标签类型', { exact: true }).selectOption('lightweight'); await expect(dialog.getByLabel('标签说明', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('标签名称', { exact: true }).fill('v-next'); await dialog.getByRole('button', { name: '创建标签', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  expect(git(repo, ['cat-file', '-t', 'refs/tags/v-next'])).toBe('commit');
  await page.getByRole('button', { name: '切换为亮色主题', exact: true }).click(); await capture(app, 'v1.7-tags-light.png');
  await page.getByLabel('筛选标签', { exact: true }).fill('发布'); await expect(page.getByRole('article')).toHaveCount(1); await page.getByLabel('筛选标签', { exact: true }).fill('');
  await page.getByRole('button', { name: '推送标签 发布/v1.7.0', exact: true }).click(); dialog = page.getByRole('dialog', { name: '推送标签', exact: true });
  await expect(dialog.getByLabel('标签推送远程', { exact: true })).toHaveValue('release'); await expect(dialog).toContainText(bare);
  await capture(app, 'v1.7-tag-push-light.png'); await dialog.getByRole('button', { name: '推送标签', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  expect(git(bare, ['for-each-ref', '--format=%(refname)'])).toBe('refs/tags/发布/v1.7.0'); expect(git(bare, ['rev-parse', 'refs/tags/发布/v1.7.0^{commit}'])).toBe(first);
  expect(git(repo, ['write-tree'])).toBe(before.index); expect(git(repo, ['status', '--porcelain', '-z'])).toBe(before.status); expect(git(repo, ['rev-parse', 'HEAD'])).toBe(head);
  expect(await readFile(path.join(repo, '中文 文件.txt'), 'utf8')).toBe('unstaged\n'); expect(await readFile(path.join(repo, '未跟踪.txt'), 'utf8')).toBe('private\n');
  await close(app, errors);
});

test('tags UI: duplicate creation, stale confirmation and conflicting remote tag keep dialogs open with actionable errors', async () => {
  const { repo, bare, first, head, app, page, errors } = await fixture(); git(repo, ['tag', 'v-test', first]);
  await navigate(page, '标签管理'); await page.getByRole('button', { name: '＋ 新建标签', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '创建标签', exact: true }); await dialog.getByLabel('标签类型').selectOption('lightweight'); await dialog.getByLabel('标签名称', { exact: true }).fill('v-test');
  await dialog.getByRole('button', { name: '创建标签', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('同名标签已存在'); await idle(page);
  await dialog.getByRole('button', { name: '关闭标签对话框' }).click();
  await page.getByRole('button', { name: '推送标签 v-test', exact: true }).click(); dialog = page.getByRole('dialog', { name: '推送标签', exact: true }); git(repo, ['tag', '-f', 'v-test', head]);
  await dialog.getByRole('button', { name: '推送标签', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('标签已被修改或删除'); await idle(page); expect(git(bare, ['for-each-ref'])).toBe('');
  await dialog.getByRole('button', { name: '关闭标签对话框' }).click(); await page.getByRole('button', { name: '刷新仓库', exact: true }).click(); await idle(page);
  git(repo, ['-c', 'push.followTags=false', 'push', '--no-follow-tags', 'release', `${first}:refs/tags/v-test`]);
  await page.getByRole('button', { name: '推送标签 v-test', exact: true }).click(); dialog = page.getByRole('dialog', { name: '推送标签', exact: true });
  await dialog.getByRole('button', { name: '推送标签', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText(/rejected|already exists/); await idle(page);
  expect(git(bare, ['rev-parse', 'refs/tags/v-test'])).toBe(first); await close(app, errors);
});

test('tags UI: empty repository disables creation and missing remote links to offline remote settings', async () => {
  const { repo, app, page, errors } = await fixture(); git(repo, ['remote', 'remove', 'release']); git(repo, ['tag', 'v-local']);
  await navigate(page, '标签管理'); await page.getByRole('button', { name: '推送标签 v-local', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '推送标签', exact: true }); await expect(dialog.getByRole('button', { name: '推送标签', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '管理远程仓库地址', exact: true }).click(); dialog = page.getByRole('dialog', { name: '远程仓库设置', exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭远程仓库设置', exact: true }).click();
  const empty = path.join(path.dirname(repo), '空仓库'); await mkdir(empty); git(empty, ['init', '--initial-branch=main']);
  await page.getByRole('button', { name: '新建项目标签', exact: true }).click(); await page.getByRole('button', { name: '打开本地仓库', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('仓库目录', { exact: true }).fill(empty); await dialog.getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(dialog).toBeHidden();
  await navigate(page, '标签管理'); await expect(page.getByRole('button', { name: '＋ 新建标签', exact: true })).toBeDisabled(); await expect(page.getByText('还没有本地标签', { exact: true })).toBeVisible(); await close(app, errors);
});
