import { nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppAppearance, AppTheme } from '../shared/types';

const colors = {
  dark: { background: '#10161d', chrome: '#141c24', text: '#dbe2e8' },
  light: { background: '#f5f7fa', chrome: '#ffffff', text: '#243545' },
};
export const TITLE_BAR_HEIGHT = 36;

/** App-owned theme only; never changes Windows personalization settings. */
export class AppearanceStore {
  private theme: AppTheme = 'dark';
  private saved = false;
  private window?: BrowserWindow;
  private writes: Promise<void> = Promise.resolve();
  constructor(private filename: string) {}
  get snapshot(): AppAppearance { return { theme: this.theme, saved: this.saved }; }
  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (value?.theme === 'dark' || value?.theme === 'light') { this.theme = value.theme; this.saved = true; }
    } catch { /* Default or migrate the renderer's existing local preference. */ }
    this.apply();
  }
  windowOptions(): BrowserWindowConstructorOptions {
    const color = colors[this.theme];
    return { backgroundColor: color.background, ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden', titleBarOverlay: { color: color.chrome, symbolColor: color.text, height: TITLE_BAR_HEIGHT },
    } : {}) };
  }
  attach(window: BrowserWindow) { this.window = window; this.apply(); }
  private apply() {
    nativeTheme.themeSource = this.theme;
    if (!this.window || this.window.isDestroyed()) return;
    const color = colors[this.theme];
    this.window.setBackgroundColor(color.background);
    if (process.platform === 'win32') this.window.setTitleBarOverlay({ color: color.chrome, symbolColor: color.text, height: TITLE_BAR_HEIGHT });
  }
  async set(value: unknown): Promise<AppAppearance> {
    if (value !== 'dark' && value !== 'light') throw new Error('主题设置无效');
    this.theme = value; this.apply();
    // Serialize rapid toggles so the final on-disk preference matches the UI.
    this.writes = this.writes.then(async () => {
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(this.filename), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ theme: value }), 'utf8');
        await fs.rename(temporary, this.filename);
        if (this.theme === value) this.saved = true;
      } catch { if (this.theme === value) this.saved = false; }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    });
    await this.writes; return this.snapshot;
  }
}
