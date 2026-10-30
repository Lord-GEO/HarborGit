import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = path.resolve(project, '../../work/history-ui');
const roots: string[] = [], apps = new Set<ElectronApplication>();
function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '.git/fixture-no-global'), GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' } });
  if (result.error) throw result.error; expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0); return result.stdout.trim();
}
async function fixture() {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-history-ui-')); roots.push(root);
  const repo = path.join(root, '仓库 中文 space'); await mkdir(repo);
  git(repo, ['init', '--initial-branch=master']);
  for (const [key, value] of [['user.name', 'History UI'], ['user.email', 'history-ui@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(repo, ['config', key, value]);
  return { root, repo };
}
async function commit(repo: string, file: string, value: string, message: string) {
  await writeFile(path.join(repo, file), value); git(repo, ['add', '--', file]); git(repo, ['commit', '-m', message]); return git(repo, ['rev-parse', 'HEAD']);
}
async function launch(root: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value;
  env.HARBOR_USER_DATA = path.join(root, 'profile'); env.HARBOR_TEST_HIDDEN = '1';
  const executable = process.env.HARBOR_EXECUTABLE;
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [project], env, timeout: 45000 }); apps.add(app);
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.getByRole('button', { name: '打开本地仓库', exact: true })).toBeVisible(); return { app, page, errors };
}
async function close(app: ElectronApplication, errors: string[]) { expect(errors).toEqual([]); await app.close(); apps.delete(app); }
async function idle(page: Page) { await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled(); }
async function open(page: Page, repo: string) {
  await page.getByRole('button', { name: '打开本地仓库', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('仓库目录', { exact: true }).fill(repo);
  await dialog.getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
}
async function navigate(page: Page, name: string) {
  await idle(page); await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
}
async function capture(app: ElectronApplication, name: string) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  try {
    const page = await app.firstWindow(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await new Promise(resolve => setTimeout(resolve, 150));
    const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true })).toPNG().toString('base64'));
    await writeFile(path.join(project, 'docs/screenshots', name), Buffer.from(bytes, 'base64'));
  } finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide()); }
}
test.afterEach(async () => { for (const app of apps) { await app.close().catch(() => {}); apps.delete(app); } });
test.afterAll(async () => {
  for (const root of roots) {
    expect(path.resolve(root).startsWith(base + path.sep) && path.basename(root).startsWith('harborgit-history-ui-')).toBe(true);
    await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
});

test('history actions UI: rollback distinguishes index from HEAD and preserves other files', async () => {
  const { root, repo } = await fixture(); await commit(repo, '文件 中文.txt', 'committed\n', 'initial content');
  await writeFile(path.join(repo, '文件 中文.txt'), 'staged\n'); git(repo, ['add', '--', '文件 中文.txt']);
  await writeFile(path.join(repo, '文件 中文.txt'), 'unstaged\n'); await writeFile(path.join(repo, 'private.txt'), 'preserve\n');
  const { app, page, errors } = await launch(root); await open(page, repo);
  await page.getByRole('button', { name: '撤销未暂存修改 文件 中文.txt', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '撤销未暂存修改', exact: true });
  await expect(dialog).toContainText('暂存区版本'); await expect(dialog.getByRole('button', { name: '确认撤销修改', exact: true })).toBeDisabled();
  await dialog.getByLabel('确认丢弃所列文件的修改', { exact: true }).check(); await capture(app, 'v1.4-rollback-confirm.png');
  await dialog.getByRole('button', { name: '确认撤销修改', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  expect(await readFile(path.join(repo, '文件 中文.txt'), 'utf8')).toBe('staged\n'); expect(git(repo, ['show', ':文件 中文.txt'])).toBe('staged');
  await page.getByRole('button', { name: '撤销暂存及工作区修改 文件 中文.txt', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '撤销暂存及工作区修改', exact: true });
  await dialog.getByLabel('确认丢弃所列文件的修改', { exact: true }).check();
  await dialog.getByRole('button', { name: '确认撤销修改', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  expect(await readFile(path.join(repo, '文件 中文.txt'), 'utf8')).toBe('committed\n'); expect(git(repo, ['show', ':文件 中文.txt'])).toBe('committed');
  expect(await readFile(path.join(repo, 'private.txt'), 'utf8')).toBe('preserve\n'); await close(app, errors);
});

test('history actions UI: Revert creates history, Mixed preserves worktree, Hard requires confirmation', async () => {
  const { root, repo } = await fixture(); await commit(repo, 'file.txt', 'base\n', 'base');
  const original = await commit(repo, 'file.txt', 'feature\n', 'feature change');
  const { app, page, errors } = await launch(root); await open(page, repo); await navigate(page, '提交历史');
  await page.getByRole('button', { name: '查看提交 feature change', exact: true }).click();
  await page.getByRole('button', { name: 'Revert 所选提交', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '反向提交 · Revert', exact: true });
  await expect(dialog).toContainText('立即创建新的反向提交'); await dialog.getByRole('button', { name: '创建反向提交', exact: true }).click();
  await expect(dialog).toBeHidden(); await idle(page);
  expect(git(repo, ['rev-parse', 'HEAD^'])).toBe(original); expect(await readFile(path.join(repo, 'file.txt'), 'utf8')).toBe('base\n');
  await page.getByRole('button', { name: '查看提交 feature change', exact: true }).click();
  await page.getByRole('button', { name: 'Reset 当前分支到所选提交', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '重置当前分支 · Reset', exact: true });
  await expect(dialog.getByRole('radio', { name: 'Mixed · 保留工作区', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '确认重置', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  expect(git(repo, ['rev-parse', 'HEAD'])).toBe(original); expect(git(repo, ['show', ':file.txt'])).toBe('feature');
  expect(await readFile(path.join(repo, 'file.txt'), 'utf8')).toBe('base\n');
  await page.getByRole('button', { name: '切换为亮色主题', exact: true }).click();
  await page.getByRole('button', { name: '查看提交 feature change', exact: true }).click();
  await page.getByRole('button', { name: 'Reset 当前分支到所选提交', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '重置当前分支 · Reset', exact: true });
  await dialog.getByRole('radio', { name: 'Hard · 丢弃已跟踪修改', exact: true }).check();
  await expect(dialog.getByRole('button', { name: '确认重置', exact: true })).toBeDisabled();
  await dialog.getByLabel('确认丢弃已跟踪的未提交修改', { exact: true }).check(); await capture(app, 'v1.4-reset-hard.png');
  await dialog.getByRole('button', { name: '确认重置', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
  expect(await readFile(path.join(repo, 'file.txt'), 'utf8')).toBe('feature\n'); expect(git(repo, ['status', '--porcelain'])).toBe(''); await close(app, errors);
});

test('history actions UI: paused rebase survives restart, labels both sides correctly and continues', async () => {
  const { root, repo } = await fixture(); await commit(repo, '冲突.txt', 'base\n', 'base'); git(repo, ['switch', '-c', 'dev']);
  const original = await commit(repo, '冲突.txt', 'dev\n', 'dev feature'); git(repo, ['switch', 'master']);
  await commit(repo, '冲突.txt', 'master\n', 'master feature'); git(repo, ['switch', 'dev']);
  const first = await launch(root); await open(first.page, repo); await navigate(first.page, '分支管理');
  await first.page.getByRole('button', { name: /变基/ }).first().click();
  const start = first.page.getByRole('dialog', { name: '将当前分支变基到目标分支', exact: true });
  await start.getByLabel('变基目标分支', { exact: true }).selectOption('master');
  await start.getByRole('button', { name: '开始变基', exact: true }).click(); await expect(start).toBeHidden(); await idle(first.page);
  await expect(first.page.getByLabel('仓库操作状态', { exact: true })).toContainText('变基'); await close(first.app, first.errors);
  const { app, page, errors } = await launch(root); await open(page, repo);
  const status = page.getByLabel('仓库操作状态', { exact: true }); await expect(status).toContainText('变基');
  await status.getByRole('button', { name: '跳过当前提交', exact: true }).click();
  const skip = page.getByRole('dialog', { name: '跳过当前变基提交', exact: true }); await expect(skip).toContainText('改动将不包含');
  await skip.getByRole('button', { name: '取消', exact: true }).click();
  await status.getByRole('button', { name: '中止变基', exact: true }).click();
  const abort = page.getByRole('dialog', { name: '中止变基', exact: true }); await expect(abort).toContainText('恢复到变基前');
  await abort.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '解决冲突 冲突.txt', exact: true }).click();
  const editor = page.getByRole('dialog'); await expect(editor).toContainText('目标基底（Ours）'); await expect(editor).toContainText('正在重放的提交（Theirs）');
  await editor.getByLabel('冲突合并结果', { exact: true }).fill('master + dev\n'); await capture(app, 'v1.4-rebase-conflict.png');
  await editor.getByRole('button', { name: '保存合并结果并暂存', exact: true }).click(); await expect(editor).toBeHidden(); await idle(page);
  await status.getByRole('button', { name: '继续变基', exact: true }).click(); await expect(status).toHaveCount(0); await idle(page);
  expect(git(repo, ['branch', '--show-current'])).toBe('dev'); expect(git(repo, ['rev-parse', 'HEAD'])).not.toBe(original);
  expect(await readFile(path.join(repo, '冲突.txt'), 'utf8')).toBe('master + dev\n'); await close(app, errors);
});
