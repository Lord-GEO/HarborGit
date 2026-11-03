import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Activity } from '../src/shared/types';

const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = path.resolve(project, '../../work/refresh-ui');
type Probe = Window & { refreshCommands: Activity[]; stopRefreshProbe: () => void };
function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global-config'), GIT_CONFIG_COUNT: '0' } });
  if (result.error) throw result.error; expect(result.status, result.stderr).toBe(0); return result.stdout.trim();
}
async function repository(root: string, name: string) {
  const repo = path.join(root, name); await mkdir(repo); git(repo, ['init', '--initial-branch=main']);
  for (const [key, value] of [['user.name', 'Refresh QA'], ['user.email', 'refresh@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(repo, ['config', key, value]);
  await writeFile(path.join(repo, '文件 中文.txt'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', `${name} initial`]); return repo;
}
async function idle(page: Page) { await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled(); }
async function open(page: Page, repo: string, initial = false) {
  await page.getByRole('button', { name: initial ? '打开本地仓库' : '打开仓库', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('仓库目录', { exact: true }).fill(repo); await dialog.getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
}
async function navigate(page: Page, name: string) { await idle(page); await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: name === '工作区' ? /^工作区/ : name, exact: name !== '工作区' }).click(); }
async function quiet(page: Page) {
  // Drain renderer -> main -> renderer messages before observing the quiet period.
  await page.evaluate(() => window.harbor.version());
  await page.waitForTimeout(350);
}
async function resetProbe(page: Page) { await quiet(page); await page.evaluate(() => { (window as unknown as Probe).refreshCommands = []; }); }
async function expectNoReads(page: Page) { await quiet(page); expect(await page.evaluate(() => (window as unknown as Probe).refreshCommands)).toEqual([]); }

test('refresh UI: focus, project tabs and cached pages stay quiet; explicit refresh and Git actions update local state', async () => {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-refresh-')); let app: ElectronApplication | undefined;
  try {
    const a = await repository(root, '项目 A'), b = await repository(root, '项目 B');
    const bare = path.join(root, '本地 remote.git'); await mkdir(bare); git(bare, ['init', '--bare', '--initial-branch=main']); git(a, ['remote', 'add', 'origin', bare]);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value;
    Object.assign(env, { HARBOR_USER_DATA: path.join(root, 'profile'), HARBOR_TEST_HIDDEN: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(base, 'no-global-config'), GIT_CONFIG_COUNT: '0' });
    const executable = process.env.HARBOR_EXECUTABLE;
    app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [project], env, timeout: 45000 });
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await page.evaluate(() => {
      const probe = window as unknown as Probe; probe.refreshCommands = [];
      probe.stopRefreshProbe = window.harbor.onActivity(event => { if (event.kind === 'start') probe.refreshCommands.push(event); });
    });
    await open(page, a, true); await navigate(page, '提交历史'); await expect(page.getByRole('button', { name: '查看提交 项目 A initial', exact: true })).toBeVisible();
    await navigate(page, '分支管理'); await expect(page.locator('.branch-info strong').filter({ hasText: 'main' }).first()).toBeVisible();
    await navigate(page, '标签管理'); await expect(page.getByText('还没有本地标签', { exact: true })).toBeVisible();
    await navigate(page, '工作区'); await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('保留草稿');
    await page.getByRole('button', { name: '新建项目标签', exact: true }).click(); await open(page, b, true);
    await page.getByRole('tab', { name: '项目 A', exact: true }).click(); await idle(page); await resetProbe(page);

    // External changes must remain unseen until an explicit refresh.
    await writeFile(path.join(a, '文件 中文.txt'), 'external edit\n'); git(a, ['branch', 'external-branch']); git(a, ['tag', 'external-tag']);
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('tab', { name: '项目 B', exact: true }).click(); await page.getByRole('tab', { name: '项目 A', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('保留草稿');
    await expect(page.getByRole('button', { name: '工作区 文件 中文.txt', exact: true })).toHaveCount(0);
    await navigate(page, '提交历史'); await navigate(page, '分支管理'); await expect(page.getByText('external-branch', { exact: true })).toHaveCount(0);
    await navigate(page, '标签管理'); await expect(page.getByRole('article', { name: '标签 external-tag', exact: true })).toHaveCount(0); await navigate(page, '工作区');
    await expectNoReads(page);

    await page.getByRole('button', { name: '刷新仓库', exact: true }).click(); await idle(page);
    await expect(page.getByRole('button', { name: '工作区 文件 中文.txt', exact: true })).toBeVisible();
    await navigate(page, '分支管理'); await expect(page.getByText('external-branch', { exact: true })).toBeVisible();
    await navigate(page, '标签管理'); await expect(page.getByRole('article', { name: '标签 external-tag', exact: true })).toBeVisible();
    await navigate(page, '工作区'); await page.getByRole('button', { name: '暂存 文件 中文.txt', exact: true }).click(); await idle(page);
    await expect(page.getByRole('button', { name: '暂存区 文件 中文.txt', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('commit after manual refresh');
    await page.getByRole('button', { name: /^提交到 / }).click(); await idle(page);
    expect(git(a, ['log', '-1', '--format=%s'])).toBe('commit after manual refresh');
    await navigate(page, '提交历史'); await expect(page.getByRole('button', { name: '查看提交 commit after manual refresh', exact: true })).toBeVisible();
    await navigate(page, '工作区'); await writeFile(path.join(a, '快捷键.txt'), 'manual shortcut\n');
    await page.keyboard.press('Control+r'); await idle(page); await expect(page.getByRole('button', { name: '工作区 快捷键.txt', exact: true })).toBeVisible();
    await resetProbe(page); await page.getByRole('tab', { name: '项目 B', exact: true }).click(); await page.getByRole('tab', { name: '项目 A', exact: true }).click(); await expectNoReads(page);

    // Explicitly reopening an existing path applies the fresh backend snapshot.
    await writeFile(path.join(a, '重新打开.txt'), 'explicit open\n'); await open(page, a); await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '工作区 重新打开.txt', exact: true })).toBeVisible();
    expect((await page.evaluate(() => (window as unknown as Probe).refreshCommands)).filter(event => /^git (?:-c \S+ )*(?:fetch|pull|push)(?:\s|$)/.test(event.command))).toEqual([]);
    expect(git(bare, ['for-each-ref'])).toBe(''); expect(errors).toEqual([]);
    await page.evaluate(() => (window as unknown as Probe).stopRefreshProbe());
  } finally {
    if (app) await app.close();
    expect(path.dirname(root)).toBe(base); expect(path.basename(root).startsWith('harborgit-refresh-')).toBe(true);
    await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
});
