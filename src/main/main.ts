import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { GitError } from './git-service';
import { Workspaces } from './workspaces';
import type { Requests, Result } from '../shared/types';

if (process.env.HARBOR_USER_DATA && path.isAbsolute(process.env.HARBOR_USER_DATA)) app.setPath('userData', process.env.HARBOR_USER_DATA);
app.setName('HarborGit');
let win: BrowserWindow | null = null;
let recentPaths: string[] = [];
const service = new Workspaces({ mergeWorkspaceRoot: path.join(app.getPath('userData'), 'merge-workspaces'), onActivity: event => { if (win && !win.isDestroyed()) win.webContents.send('harbor:activity', event); } });
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
function verifySender(event: IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid IPC sender');
}
async function remember(root: string) {
  recentPaths = [root, ...recentPaths.filter(p => p !== root)].slice(0, 12);
  try { await fs.mkdir(app.getPath('userData'), { recursive: true }); await fs.writeFile(recentFile(), JSON.stringify(recentPaths), 'utf8'); } catch { /* A read-only profile does not prevent using Git. */ }
}
app.whenReady().then(async () => {
  try { const value: unknown = JSON.parse(await fs.readFile(recentFile(), 'utf8')); if (Array.isArray(value)) recentPaths = value.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)).slice(0, 12); } catch { /* First launch. */ }
  ipcMain.handle('harbor:request', async (event, operation: keyof Requests, payload: unknown, sessionId?: string): Promise<Result<unknown>> => {
    verifySender(event);
    try {
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
  win = new BrowserWindow({
    title: 'HarborGit', width: 1460, height: 940, minWidth: 1100, minHeight: 720, backgroundColor: '#111820',
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
});
app.on('window-all-closed', () => { service.cancelAll(); app.quit(); });
app.on('before-quit', () => service.cancelAll());
