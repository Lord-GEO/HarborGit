import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const { _electron: electron, expect } = createRequire(path.join(project, 'package.json'))('@playwright/test');
const base = path.resolve(project, '../../work/merge-ui'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'harborgit-merge-ui-'));
const repo = path.join(root, '项目 中文 space'); await mkdir(repo);
const config = 'synergia-service/synergia-omp/src/main/resources/application-dev.yml';
const gateway = 'synergia-gateway/src/main/resources/application-dev.yml';
const bootstrap = 'synergia-gateway/src/main/resources/bootstrap.yml';
let app;
const report = { version: '1.9.2', status: 'incomplete', mode: 'packaged', checks: [], fullRegressionRun: false };
const git = args => {
  const r = spawnSync('git', args, { cwd: repo, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global'), GIT_CONFIG_COUNT: '0' } });
  if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim();
};
async function capture(name) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await (await app.firstWindow()).waitForTimeout(250);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true })).toPNG().toString('base64'));
  await writeFile(path.join(project, `docs/screenshots/v1.9.2-${name}.png`), Buffer.from(png, 'base64'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
}
try {
  git(['init', '-b', 'master']);
  for (const [key, value] of [['user.name', 'Merge UI'], ['user.email', 'merge-ui@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(['config', key, value]);
  for (const file of [config, gateway, bootstrap]) { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), 'value: base\n'); }
  git(['add', '.']); git(['commit', '-m', 'base']); git(['switch', '-c', 'dev']);
  await writeFile(path.join(repo, config), 'value: dev committed\n'); git(['add', '.']); git(['commit', '-m', 'dev commit']); const target = git(['rev-parse', 'HEAD']);
  git(['switch', 'master']); await writeFile(path.join(repo, config), 'value: master committed\n'); git(['add', '.']); git(['commit', '-m', 'master commit']); const original = git(['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, config), 'value: private local\n'); await writeFile(path.join(repo, gateway), 'value: private gateway\n');
  await writeFile(path.join(repo, bootstrap), 'value: private staged\n'); git(['add', '--', bootstrap]); await writeFile(path.join(repo, '未跟踪 空格.txt'), 'private retained\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined));
  Object.assign(env, { HARBOR_USER_DATA: path.join(root, 'profile'), HARBOR_TEST_HIDDEN: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global'), GIT_CONFIG_COUNT: '0' });
  app = await electron.launch({ executablePath: path.join(project, 'release/win-unpacked/HarborGit.exe'), args: [], env, timeout: 45000 });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setBounds({ width: 1440, height: 940 }); });
  await page.getByRole('button', { name: '打开本地仓库', exact: true }).click(); await page.getByLabel('仓库目录', { exact: true }).fill(repo);
  await page.getByRole('dialog').getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: '分支管理', exact: true }).click();
  await page.locator('.branch-row').filter({ has: page.getByText('dev', { exact: true }) }).getByRole('button', { name: '合并到当前', exact: true }).click();
  const banner = page.getByRole('region', { name: '分支合并改动备份', exact: true });
  await expect(banner.getByText('分支合并进行中 · 原改动已保存', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(banner.getByText('dev → master', { exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '工作区改动', exact: true })).toBeVisible();
  expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(target); expect(git(['rev-parse', 'HEAD'])).toBe(original);
  expect(await readFile(path.join(repo, '未跟踪 空格.txt')).then(() => true, () => false)).toBe(false); await capture('branch-merge-conflict');
  await page.getByRole('button', { name: `解决冲突 ${config}`, exact: true }).click(); let dialog = page.getByRole('dialog');
  await dialog.getByLabel('冲突合并结果', { exact: true }).fill('value: master and dev committed\n'); await dialog.getByRole('button', { name: '保存合并结果并暂存', exact: true }).click(); await expect(dialog).toBeHidden();
  await page.getByLabel('提交信息', { exact: true }).fill('merge dev into master'); await page.getByRole('button', { name: '提交合并并恢复原改动', exact: true }).click();
  await expect(banner.getByText('保存的改动恢复时出现冲突', { exact: true })).toBeVisible({ timeout: 30000 });
  expect(git(['show', '-s', '--format=%P', 'HEAD'])).toBe(`${original} ${target}`); expect(git(['show', `HEAD:${bootstrap}`])).toBe('value: base');
  report.checks.push('Local dev merge automatically saves three dirty configuration files and untracked WIP; merge commit excludes private WIP');
  await page.getByRole('button', { name: `解决冲突 ${config}`, exact: true }).click(); dialog = page.getByRole('dialog');
  await expect(dialog.getByText('合并后的内容（Ours）', { exact: true })).toBeVisible(); await capture('merge-wip-restore-conflict');
  await dialog.getByLabel('冲突合并结果', { exact: true }).fill('value: master and dev and private local\n'); await dialog.getByRole('button', { name: '保存合并结果并暂存', exact: true }).click(); await expect(dialog).toBeHidden();
  // Git may stage unrelated WIP paths when another restored file conflicts.
  // Verify that the UI lets the user restore the intended split explicitly.
  await page.getByRole('button', { name: `取消暂存 ${gateway}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `工作区 ${gateway}`, exact: true })).toBeVisible();
  await banner.getByRole('button', { name: '结束恢复并保留备份', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '已检查并处理恢复的改动', exact: true }).check(); await dialog.getByRole('button', { name: '确认结束恢复并保留备份', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(banner.getByText('未提交改动恢复已结束', { exact: true })).toBeVisible();
  expect(git(['show', `:${bootstrap}`])).toBe('value: private staged'); expect(git(['show', `:${gateway}`])).toBe('value: base'); expect(await readFile(path.join(repo, gateway), 'utf8')).toBe('value: private gateway\n');
  expect(await readFile(path.join(repo, '未跟踪 空格.txt'), 'utf8')).toBe('private retained\n'); expect(git(['stash', 'list'])).toContain('HarborGit merge autosave'); expect(git(['rev-parse', 'refs/heads/dev'])).toBe(target); expect(errors).toEqual([]);
  report.checks.push('Branch conflict -> merge commit -> separate WIP conflict -> edit and finish; staged split explicitly checked and adjusted after restore conflict; source tip, untracked file and backups preserved; no renderer errors'); report.status = 'passed';
} catch (error) { report.error = error.stack || String(error); throw error; }
finally {
  if (app) await app.close().catch(() => {});
  if (path.dirname(root) !== base || !path.basename(root).startsWith('harborgit-merge-ui-')) throw new Error('Unexpected cleanup path');
  await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); report.fixtureRemoved = true;
  await writeFile(path.join(project, 'docs/verification-v1.9.2-merge-ui.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
