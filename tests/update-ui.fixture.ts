// Test-only application shell: real renderer/preload/service, deterministic
// update engine. No external network, installer launch or real user profile.
import { app, BrowserWindow, ipcMain } from 'electron';
import { UpdateService } from '../src/main/updates';
import path from 'node:path';
const project = process.env.HARBOR_FIXTURE_PROJECT!, root = process.env.HARBOR_USER_DATA!;
if (!project || !root || !path.resolve(root).startsWith(path.resolve(project, '../../work/ui-integration') + path.sep)) throw new Error('Invalid fixture directory');
app.setPath('userData', root);
let busy = false, checkError = false, downloads = 0, installs = 0;
ipcMain.on('fixture:control', (_event, value) => { busy = !!value.busy; checkError = !!value.checkError; });
ipcMain.handle('fixture:counters', () => ({ downloads, installs }));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1460, height: 940, webPreferences: { preload: path.join(project, 'dist-electron/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const updates = new UpdateService({ currentVersion: '1.3.0', mode: 'installer', settingsFile: path.join(root, 'update-settings.json'), canInstall: () => !busy, onState: value => win.webContents.send('harbor:update', value), engine: {
    async check() { if (checkError) throw new Error('404 fixture'); return { version: '1.3.1', notes: '本地 UI fixture：展示更新说明。\n<script>window.untrusted=true</script>' }; },
    async download(signal, progress) {
      downloads++;
      for (let i = 0; i <= 10; i++) {
        if (signal.aborted) throw new Error('aborted');
        progress({ percent: i * 10, transferred: i * 1024 * 1024, total: 10 * 1024 * 1024, bytesPerSecond: 5 * 1024 * 1024 });
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    },
    install() { installs++; },
  } });
  await updates.load();
  const verify = (event: Electron.IpcMainInvokeEvent) => { if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid fixture sender'); };
  ipcMain.handle('harbor:recent', () => []); ipcMain.handle('harbor:version', () => '1.3.0');
  ipcMain.handle('harbor:update-status', event => { verify(event); return updates.snapshot; });
  ipcMain.handle('harbor:update-auto-check', async (event, enabled) => { verify(event); return { ok: true, data: await updates.saveAutoCheck(enabled) }; });
  ipcMain.handle('harbor:update-action', async (event, action) => {
    verify(event);
    try {
      if (action === 'check') return { ok: true, data: await updates.check() };
      if (action === 'download') return { ok: true, data: await updates.download() };
      if (action === 'cancel') return { ok: true, data: updates.cancel() };
      if (action === 'install') return { ok: true, data: updates.install() };
      throw new Error('Unsupported fixture action');
    } catch (error) { return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }; }
  });
  app.on('before-quit', () => updates.dispose());
  await win.loadFile(path.join(project, 'dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
