// One focused runtime smoke check. All writes stay in owned temporary repositories.
import { _electron as electron, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = path.resolve(project, '../../work/terminal-smoke');
const version = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version;
await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'harborgit-terminal-'));
let app;
const report = { version, status: 'incomplete', checks: [], mode: process.env.HARBOR_EXECUTABLE ? 'packaged' : 'source', fullRegressionRun: false };
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global'), GIT_CONFIG_COUNT: '0' } });
  if (result.status !== 0) throw new Error(result.stderr || 'Git fixture failed'); return result.stdout.trim();
}
async function repo(name) {
  const folder = path.join(root, name); await mkdir(folder); git(folder, ['init', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Terminal Smoke'], ['user.email', 'terminal@example.invalid'], ['commit.gpgsign', 'false']]) git(folder, ['config', key, value]);
  await writeFile(path.join(folder, 'README.md'), 'terminal smoke\n'); git(folder, ['add', '.']); git(folder, ['commit', '-m', 'initial']); return folder;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function contents(file) { return readFile(file, 'utf8').catch(() => ''); }
async function idle(page) { await expect(page.getByRole('button', { name: '刷新仓库', exact: true })).toBeEnabled(); }
async function open(page, folder) {
  await page.getByRole('button', { name: '打开本地仓库', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('仓库目录', { exact: true }).fill(folder); await dialog.getByRole('button', { name: '打开仓库', exact: true }).click(); await expect(dialog).toBeHidden(); await idle(page);
}
async function start(page) {
  await page.getByRole('button', { name: '打开项目终端', exact: true }).click();
  const region = page.getByRole('region', { name: '项目终端', exact: true });
  await expect(region).toBeVisible(); await expect(region).toHaveAttribute('data-terminal-id', /.+/, { timeout: 20000 });
  const id = await region.getAttribute('data-terminal-id'), pid = Number(await region.getAttribute('data-terminal-pid'));
  await expect.poll(() => page.evaluate(id => (window.terminalSmokeOutput[id] || '').replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '').includes('PS '), id), { timeout: 20000 }).toBe(true);
  return { region, id, pid };
}
async function command(page, region, text) {
  const input = region.locator('.xterm-helper-textarea'); await input.focus();
  // CDP insertText does not represent xterm's key/composition handling. Use
  // real key events for ASCII and the real paste handler for Unicode text.
  if (/^[\x00-\x7f]*$/.test(text)) await page.keyboard.type(text);
  else await input.evaluate((element, value) => { const data = new DataTransfer(); data.setData('text/plain', value); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, text);
  await page.keyboard.press('Enter');
}
try {
  const a = await repo('项目 A 中文 space'), b = await repo('项目 B');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined));
  Object.assign(env, { HARBOR_USER_DATA: path.join(root, 'profile'), HARBOR_TEST_HIDDEN: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global'), GIT_CONFIG_COUNT: '0' });
  const executable = process.env.HARBOR_EXECUTABLE;
  app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [project], env, timeout: 45000 });
  const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.evaluate(() => { window.terminalSmokeOutput = {}; window.harbor.onTerminal(event => { if (event.kind === 'data') window.terminalSmokeOutput[event.id] = ((window.terminalSmokeOutput[event.id] || '') + event.data).slice(-524288); }); });
  await open(page, a); const first = await start(page);
  await command(page, first.region, "$typedProbe='typed';");
  await command(page, first.region, "$harborTerminalProbe='项目A'; [IO.File]::WriteAllText((Join-Path $PWD 'terminal-中文.txt'), \"$PWD`n$PID`n$harborTerminalProbe`n$typedProbe`n$(git rev-parse --show-toplevel)\", [Text.UTF8Encoding]::new($false))");
  await expect.poll(() => contents(path.join(a, 'terminal-中文.txt')), { timeout: 15000 }).toContain('项目A');
  const proof = await contents(path.join(a, 'terminal-中文.txt')); expect(proof).toContain('typed'); expect(proof).toContain(a); expect(proof).toContain(String(first.pid)); expect(proof.replaceAll('\\', '/')).toContain(a.replaceAll('\\', '/'));
  report.checks.push('Packaged native PTY, interactive input, Chinese output, repository cwd and Git command');
  await expect(page.getByRole('button', { name: '工作区 terminal-中文.txt', exact: true })).toHaveCount(0);
  await first.region.getByRole('button', { name: '收起终端' }).click(); await page.getByRole('button', { name: '刷新仓库', exact: true }).click(); await idle(page);
  await expect(page.getByRole('button', { name: '工作区 terminal-中文.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开项目终端', exact: true }).click(); await expect(first.region).toHaveAttribute('data-terminal-id', first.id);
  await page.getByRole('button', { name: '新建项目标签', exact: true }).click(); await open(page, b); const second = await start(page);
  expect(second.id).not.toBe(first.id); expect(second.pid).not.toBe(first.pid);
  await command(page, second.region, "[IO.File]::WriteAllText((Join-Path $PWD 'terminal-B.txt'), \"$PWD`n$harborTerminalProbe\", [Text.UTF8Encoding]::new($false))");
  await expect.poll(() => contents(path.join(b, 'terminal-B.txt')), { timeout: 15000 }).toContain(b);
  expect(await contents(path.join(b, 'terminal-B.txt'))).not.toContain('项目A');
  await page.getByRole('tab', { name: '项目 A 中文 space', exact: true }).click(); await expect(first.region).toHaveAttribute('data-terminal-id', first.id);
  await command(page, first.region, "[IO.File]::WriteAllText((Join-Path $PWD 'retained.txt'), $harborTerminalProbe, [Text.UTF8Encoding]::new($false))");
  await expect.poll(() => contents(path.join(a, 'retained.txt')), { timeout: 15000 }).toBe('项目A');
  report.checks.push('Hide/show and project switching preserve independent shell sessions; Git UI refresh stays manual');
  await command(page, first.region, "[IO.File]::WriteAllText((Join-Path $PWD 'sleep-start.txt'), 'start'); Start-Sleep -Seconds 30; [IO.File]::WriteAllText((Join-Path $PWD 'should-not-run.txt'), 'bad')");
  await expect.poll(() => contents(path.join(a, 'sleep-start.txt')), { timeout: 15000 }).toBe('start');
  await page.keyboard.press('Control+c'); await page.waitForTimeout(250);
  await command(page, first.region, "[IO.File]::WriteAllText((Join-Path $PWD 'after-cancel.txt'), 'resumed')");
  await expect.poll(() => contents(path.join(a, 'after-cancel.txt')), { timeout: 15000 }).toBe('resumed');
  expect(await access(path.join(a, 'should-not-run.txt')).then(() => true, () => false)).toBe(false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 720 }));
  await page.getByRole('button', { name: '切换为亮色主题', exact: true }).click();
  await expect.poll(() => first.region.locator('.xterm-screen').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(100);
  report.checks.push('Ctrl+C interrupts running command; resize and light theme remain usable');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive()); await page.waitForTimeout(180);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true })).toPNG().toString('base64'));
  await writeFile(path.join(project, `docs/screenshots/v${version}-terminal.png`), Buffer.from(png, 'base64'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.getByRole('button', { name: '关闭项目 项目 B', exact: true }).click();
  await expect.poll(() => alive(second.pid), { timeout: 12000 }).toBe(false); expect(alive(first.pid)).toBe(true);
  expect(errors).toEqual([]); await app.close(); app = undefined;
  await expect.poll(() => alive(first.pid), { timeout: 12000 }).toBe(false);
  report.checks.push('Closing a project and quitting the app clean up their own PTYs'); report.status = 'passed';
} catch (error) {
  report.error = error.stack || String(error);
  if (app) report.terminalOutput = await (await app.firstWindow()).evaluate(() => Object.fromEntries(Object.entries(window.terminalSmokeOutput || {}).map(([id, text]) => [id, text.slice(-16000)]))).catch(() => ({}));
  throw error;
}
finally {
  if (app) await app.close().catch(() => {});
  if (path.dirname(root) !== base || !path.basename(root).startsWith('harborgit-terminal-')) throw new Error('Unexpected cleanup path');
  await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); report.fixtureRemoved = true;
  await writeFile(path.join(project, `docs/verification-v${version}-terminal.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
