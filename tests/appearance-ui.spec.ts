import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const parent = path.resolve(project, '../../work/appearance-ui');
const roots: string[] = [], apps = new Set<ElectronApplication>();
function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '.git/fixture-global') } });
  if (result.error) throw result.error; expect(result.status, result.stderr).toBe(0); return result.stdout.trim();
}
async function fixture() { await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, 'harborgit-appearance-')); roots.push(root); return root; }
async function repository(root: string, name: string) {
  const repo = path.join(root, name); await mkdir(repo); git(repo, ['init', '-b', 'master']);
  for (const [key, value] of [['user.name', 'Appearance QA'], ['user.email', 'appearance@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(repo, ['config', key, value]);
  for (const file of ['README.md', '中文 配置.ts', 'ui.css']) await writeFile(path.join(repo, file), 'base\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-m', '初始化界面验证仓库']);
  for (const file of ['README.md', '中文 配置.ts', 'ui.css']) await writeFile(path.join(repo, file), 'readable theme and layout\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-m', '优化主题配色与标签布局，保留清晰的提交历史和文件差异']); return repo;
}
async function launch(root: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value;
  env.HARBOR_USER_DATA = path.join(root, 'profile'); env.HARBOR_TEST_HIDDEN = '1'; const executable = process.env.HARBOR_EXECUTABLE;
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [project], env, timeout: 45000 }); apps.add(app);
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.getByRole('button', { name: '切换为亮色主题', exact: true }).or(page.getByRole('button', { name: '切换为暗色主题', exact: true }))).toBeEnabled(); return { app, page, errors };
}
async function close(app: ElectronApplication, errors: string[]) { expect(errors).toEqual([]); await app.close(); apps.delete(app); }
async function open(page: Page, repo: string, initial = false) {
  await page.getByRole('button', { name: initial ? '打开本地仓库' : '打开仓库', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('仓库目录', { exact: true }).fill(repo); await dialog.getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled();
}
async function capture(app: ElectronApplication, name: string, native = false) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  try {
    const page = await app.firstWindow(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.waitForTimeout(180);
    const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }, useNative) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (useNative && process.platform === 'win32') {
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1800, height: 1200 } });
        const source = sources.find(item => item.id === win.getMediaSourceId());
        if (!source || source.thumbnail.isEmpty()) throw new Error('Own QA window could not be captured with native controls');
        return source.thumbnail.toPNG().toString('base64');
      }
      return (await win.webContents.capturePage(undefined, { stayAwake: true })).toPNG().toString('base64');
    }, native);
    await writeFile(path.join(project, 'docs/screenshots', name), Buffer.from(png, 'base64'));
  } finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide()); }
}
async function nativeTheme(app: ElectronApplication) { return app.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors })); }
async function adjacentPlus(page: Page) {
  const plus = await page.getByRole('button', { name: '新建项目标签', exact: true }).boundingBox(); const tab = await page.locator('.project-tab').last().boundingBox();
  expect(plus && tab).toBeTruthy(); expect(plus!.x - (tab!.x + tab!.width)).toBeGreaterThanOrEqual(-1); expect(plus!.x - (tab!.x + tab!.width)).toBeLessThan(14);
  const controls = await page.locator('.project-strip-actions').boundingBox(); expect(plus!.x + plus!.width).toBeLessThanOrEqual(controls!.x); return { plus, tab };
}
test.afterEach(async () => { for (const app of apps) { await app.close().catch(() => {}); apps.delete(app); } });
test.afterAll(async () => { for (const root of roots) { expect(root.startsWith(parent + path.sep) && path.basename(root).startsWith('harborgit-appearance-')).toBe(true); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } });

test('appearance UI: readable history, light hover, native title bar and saved theme agree after restart', async () => {
  const root = await fixture(), repo = await repository(root, '界面验证项目'); const { app, page, errors } = await launch(root);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); expect(await nativeTheme(app)).toEqual({ source: 'dark', dark: true });
  if (process.platform === 'win32') {
    await expect(page.getByLabel('窗口标题栏', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible)).toBe(true);
  }
  await open(page, repo, true); await adjacentPlus(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '提交历史', exact: true }).click();
  await page.getByRole('button', { name: '查看提交 优化主题配色与标签布局，保留清晰的提交历史和文件差异', exact: true }).click();
  await expect(page.locator('.history-files button')).toHaveCount(3);
  await expect(page.locator('.graph-commit-row small').first()).toHaveCSS('font-size', '12px');
  await expect(page.locator('.diff-table .added pre').first()).toHaveCSS('font-size', '13px');
  expect(await page.locator('.graph-commit-row').evaluateAll(rows => rows.every(row => row.querySelector('code')!.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom - 6))).toBe(true);
  await capture(app, 'v1.6.2-history-dark.png'); await capture(app, 'v1.6.2-native-dark.png', true);
  await page.getByRole('button', { name: '切换为亮色主题', exact: true }).click(); await expect.poll(() => nativeTheme(app)).toEqual({ source: 'light', dark: false });
  const unselected = page.locator('.history-files button:not(.selected)').first(); await unselected.hover();
  await expect(unselected).toHaveCSS('background-color', 'rgb(224, 235, 242)'); await expect(unselected).toHaveCSS('color', 'rgb(40, 72, 93)');
  await capture(app, 'v1.6.2-history-light-hover.png'); await capture(app, 'v1.6.2-native-light.png', true);
  await page.locator('.history-files button.selected').hover(); await expect(page.locator('.history-files button.selected')).toHaveCSS('background-color', 'rgb(207, 231, 220)');
  const invalid = await page.evaluate(() => window.harbor.setTheme('system' as 'dark')); expect(invalid.ok).toBe(false); expect((await nativeTheme(app)).dark).toBe(false);
  const metrics = await page.evaluate(() => ({ text: getComputedStyle(document.querySelector('.graph-commit-row small')!).fontSize, code: getComputedStyle(document.querySelector('.diff-table .added pre')!).fontSize, plusGap: document.querySelector('.new-project-tab')!.getBoundingClientRect().left - document.querySelector('.project-tab:last-child')!.getBoundingClientRect().right, theme: document.documentElement.dataset.theme }));
  await writeFile(path.join(project, 'docs/verification-v1.6.2-appearance-metrics.json'), JSON.stringify(metrics, null, 2));
  await expect.poll(async () => JSON.parse(await readFile(path.join(root, 'profile/appearance.json'), 'utf8')).theme).toBe('light');
  // A stale renderer preference must not override the saved native appearance.
  await page.evaluate(() => localStorage.setItem('harbor-theme', 'dark')); await close(app, errors);
  const next = await launch(root); await expect(next.page.locator('html')).toHaveAttribute('data-theme', 'light'); expect(await nativeTheme(next.app)).toEqual({ source: 'light', dark: false });
  await next.page.getByRole('button', { name: '切换为暗色主题', exact: true }).click(); await expect.poll(() => nativeTheme(next.app)).toEqual({ source: 'dark', dark: true });
  await expect.poll(async () => JSON.parse(await readFile(path.join(root, 'profile/appearance.json'), 'utf8')).theme).toBe('dark'); await close(next.app, next.errors);
});

test('appearance UI: plus follows tabs and remains usable with long names at compact window size', async () => {
  const root = await fixture(); const repos = [];
  for (const name of ['项目甲 - 长项目名称与中文路径展示验证 Alpha', '项目乙 - 长项目名称与中文路径展示验证 Bravo', '项目丙 - 长项目名称与中文路径展示验证 Charlie', '项目丁 - 长项目名称与中文路径展示验证 Delta']) repos.push(await repository(root, name));
  const { app, page, errors } = await launch(root); await open(page, repos[0], true); await adjacentPlus(page);
  for (const repo of repos.slice(1, 3)) { await open(page, repo); await adjacentPlus(page); }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await adjacentPlus(page); await page.getByRole('button', { name: '新建项目标签', exact: true }).click(); await expect(page.getByRole('tab')).toHaveCount(4); await adjacentPlus(page);
  await expect.poll(() => page.evaluate(() => { const el = document.querySelector('.project-tabs')!; return el.scrollWidth > el.clientWidth; })).toBe(true);
  await expect(page.getByRole('tab', { name: '新项目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await capture(app, 'v1.6.2-tabs-compact-dark.png');
  await open(page, repos[3], true); await expect(page.getByRole('tab')).toHaveCount(4); await adjacentPlus(page);
  await page.getByRole('button', { name: '关闭项目 项目丁 - 长项目名称与中文路径展示验证 Delta', exact: true }).click(); await expect(page.getByRole('tab')).toHaveCount(3); await adjacentPlus(page);
  await page.getByRole('button', { name: '切换为亮色主题', exact: true }).click(); await adjacentPlus(page);
  await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled();
  await expect(page.locator('.tab-panel:not([hidden]) .commit-submit')).toHaveCSS('background-color', 'rgb(237, 243, 247)');
  const activity = page.locator('.tab-panel:not([hidden])').getByRole('button', { name: '操作日志', exact: true });
  await activity.scrollIntoViewIfNeeded(); await expect(activity).toBeInViewport();
  if (process.platform === 'win32') expect((await page.getByLabel('窗口标题栏', { exact: true }).boundingBox())!.y).toBe(0);
  await page.locator('.tab-panel:not([hidden]) .sidebar').evaluate(element => { element.scrollTop = 0; });
  const status = await page.locator('.tab-panel:not([hidden]) .status-bar').boundingBox(); expect(status!.y + status!.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) + 1);
  await capture(app, 'v1.6.2-tabs-compact-light.png');
  // Simulate upgrading a profile that only has the original localStorage theme.
  await page.evaluate(() => localStorage.setItem('harbor-theme', 'light')); await close(app, errors); await rm(path.join(root, 'profile/appearance.json'));
  const next = await launch(root); await expect(next.page.locator('html')).toHaveAttribute('data-theme', 'light'); await expect.poll(() => nativeTheme(next.app)).toEqual({ source: 'light', dark: false }); await close(next.app, next.errors);
});
