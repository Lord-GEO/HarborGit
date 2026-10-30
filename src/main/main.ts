import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { GitError } from './git-service';
import { Workspaces } from './workspaces';
import { AiSettingsStore, generateMessage } from './ai';
import { UpdateService, RELEASES_URL } from './updates';
import { createUpdateEngine } from './update-engine';
import type { Requests, Result, AiSettingsInput } from '../shared/types';

if (process.env.HARBOR_USER_DATA && path.isAbsolute(process.env.HARBOR_USER_DATA)) app.setPath('userData', process.env.HARBOR_USER_DATA);
app.setName('HarborGit');
if (process.platform === 'win32') app.setAppUserModelId('dev.harborgit.desktop');
let win: BrowserWindow | null = null;
let updates: UpdateService | undefined;
let updateConfirmationOpen = false;
let recentPaths: string[] = [];
const ai = new AiSettingsStore(path.join(app.getPath('userData'), 'ai-settings.json'), { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptStringAsync(value), decrypt: async value => (await safeStorage.decryptStringAsync(value)).result });
const service = new Workspaces({ generateMessage: async (snapshot, signal) => generateMessage(await ai.requestConfig(), snapshot, signal), mergeWorkspaceRoot: path.join(app.getPath('userData'), 'merge-workspaces'), onActivity: event => { if (win && !win.isDestroyed()) win.webContents.send('harbor:activity', event); } });
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
function verifySender(event: IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid IPC sender');
}
async function remember(root: string) {
  recentPaths = [root, ...recentPaths.filter(p => p !== root)].slice(0, 12);
  try { await fs.mkdir(app.getPath('userData'), { recursive: true }); await fs.writeFile(recentFile(), JSON.stringify(recentPaths), 'utf8'); } catch { /* A read-only profile does not prevent using Git. */ }
}
app.whenReady().then(async () => {
  const executable = app.getPath('exe');
  const installed = app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE && await fs.access(path.join(path.dirname(executable), `Uninstall ${path.basename(executable, '.exe')}.exe`)).then(() => true, () => false);
  const mode = !app.isPackaged ? 'development' : installed ? 'installer' : 'manual';
  updates = new UpdateService({
    currentVersion: app.getVersion(), mode, settingsFile: path.join(app.getPath('userData'), 'update-settings.json'),
    message: mode === 'development' ? '开发模式不执行应用更新，请使用 Windows Setup 安装版。' : mode === 'manual' ? '此版本请从发布页下载更新。Windows 安装版支持应用内下载和安装；当前便携版、目录版及未签名 macOS 版使用手动更新。' : undefined,
    engine: installed ? createUpdateEngine(error => updates?.installFailed(error)) : undefined,
    canInstall: () => service.pendingCount === 0,
    onState: state => { if (win && !win.isDestroyed()) win.webContents.send('harbor:update', state); },
  });
  await updates.load();
  try { const value: unknown = JSON.parse(await fs.readFile(recentFile(), 'utf8')); if (Array.isArray(value)) recentPaths = value.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)).slice(0, 12); } catch { /* First launch. */ }
  ipcMain.handle('harbor:request', async (event, operation: keyof Requests, payload: unknown, sessionId?: string): Promise<Result<unknown>> => {
    verifySender(event);
    try {
      if (updates?.isInstalling) throw new Error('正在安装更新，请等待应用重启');
      const data = await service.request(operation, payload as never, sessionId);
      if ((operation === 'open' || operation === 'clone') && data && 'root' in Object(data)) await remember((data as { root: string }).root);
      if (operation === 'mergeInto' && data && 'mergeRepository' in Object(data)) { const recovery = (data as { mergeRepository?: { root: string } }).mergeRepository; if (recovery) await remember(recovery.root); }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof GitError ? e.details : { message: e instanceof Error ? e.message : String(e) } };
    }
  });
  ipcMain.handle('harbor:close-repository', (event, sessionId: string): Result<boolean> => {
    verifySender(event);
    try { return { ok: true, data: service.close(sessionId) }; }
    catch (e) { return { ok: false, error: e instanceof GitError ? e.details : { message: String(e) } }; }
  });
  ipcMain.handle('harbor:pick-directory', async event => { verifySender(event); const result = await dialog.showOpenDialog(win!, { title: '选择仓库或父目录', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('harbor:cancel', (event, id: string) => { verifySender(event); return typeof id === 'string' && service.cancel(id); });
  ipcMain.handle('harbor:recent', event => { verifySender(event); return recentPaths; });
  ipcMain.handle('harbor:version', event => { verifySender(event); return app.getVersion(); });
  ipcMain.handle('harbor:update-status', event => { verifySender(event); return updates!.snapshot; });
  ipcMain.handle('harbor:update-auto-check', async (event, enabled: boolean) => {
    verifySender(event);
    try { return { ok: true, data: await updates!.saveAutoCheck(enabled) }; }
    catch { return { ok: false, error: { message: '无法保存更新设置，请检查配置目录的写入权限' } }; }
  });
  ipcMain.handle('harbor:update-action', async (event, action: unknown) => {
    verifySender(event);
    try {
      switch (action) {
        case 'check': return { ok: true, data: await updates!.check() };
        case 'download': return { ok: true, data: await updates!.download() };
        case 'cancel': return { ok: true, data: updates!.cancel() };
        case 'open-release': await shell.openExternal(RELEASES_URL); return { ok: true, data: updates!.snapshot };
        case 'install': {
          if (updates!.snapshot.phase !== 'downloaded') throw new Error('请先下载并校验更新');
          if (service.pendingCount) throw new Error('项目仍有任务运行，请完成或取消后再安装更新');
          if (updateConfirmationOpen) throw new Error('请先处理已打开的安装确认窗口');
          updateConfirmationOpen = true;
          try {
            const result = await dialog.showMessageBox(win!, { type: 'question', title: '安装 HarborGit 更新', message: '退出 HarborGit 并安装更新？', detail: '请先保存编辑内容和提交消息草稿。Git 仓库的暂存、未提交修改及应用配置会保留。', buttons: ['退出并安装', '取消'], defaultId: 1, cancelId: 1, noLink: true });
            return { ok: true, data: result.response === 0 ? updates!.install() : updates!.snapshot };
          } finally { updateConfirmationOpen = false; }
        }
        default: throw new Error('无效的更新操作');
      }
    } catch (error) { return { ok: false, error: { message: error instanceof Error ? error.message : '更新操作失败' } }; }
  });
  ipcMain.handle('harbor:ai-settings', async event => {
    verifySender(event); try { return { ok: true, data: await ai.get() }; } catch (e) { return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } }; }
  });
  ipcMain.handle('harbor:save-ai-settings', async (event, input: AiSettingsInput) => {
    verifySender(event); try { return { ok: true, data: await ai.save(input) }; } catch (e) { return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } }; }
  });
  win = new BrowserWindow({
    title: 'HarborGit', icon: path.join(__dirname, '../assets/harborgit-256.png'), width: 1460, height: 940, minWidth: 1100, minHeight: 720, backgroundColor: '#111820',
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  const devURL = !app.isPackaged && process.env.HARBOR_DEV_URL === 'http://127.0.0.1:5173' ? process.env.HARBOR_DEV_URL : '';
  win.webContents.on('will-navigate', (e, url) => { if (!devURL || new URL(url).origin !== new URL(devURL).origin) e.preventDefault(); });
  win.once('ready-to-show', () => { if (!process.env.HARBOR_TEST_HIDDEN) win?.show(); });
  win.on('closed', () => { win = null; });
  if (devURL) await win.loadURL(devURL); else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  if (!process.env.HARBOR_TEST_HIDDEN) updates.schedule();
});
app.on('window-all-closed', () => { service.cancelAll(); app.quit(); });
app.on('before-quit', () => { updates?.dispose(); service.cancelAll(); });
