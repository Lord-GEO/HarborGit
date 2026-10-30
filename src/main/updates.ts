import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { UpdateProgress, UpdateRelease, UpdateState } from '../shared/types';

export const RELEASES_URL = 'https://github.com/Lord-GEO/HarborGit/releases/latest';
export interface UpdateEngine {
  check(): Promise<UpdateRelease | null>;
  download(signal: AbortSignal, progress: (value: UpdateProgress) => void): Promise<void>;
  install(): void;
}
interface UpdateOptions {
  currentVersion: string; mode: UpdateState['mode']; message?: string; settingsFile: string;
  engine?: UpdateEngine; onState?: (state: UpdateState) => void; canInstall(): boolean;
  checkTimeoutMs?: number; downloadTimeoutMs?: number;
}
export function updateError(error: unknown): string {
  const code = String((error as { code?: unknown })?.code || '');
  const message = error instanceof Error ? error.message : String(error);
  if (/404|LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND|NO_PUBLISHED_VERSIONS|No published versions|Cannot find latest/i.test(code + message)) return '发布源尚无可用更新信息。请确认 GitHub Release 同时包含安装包、latest.yml 和 blockmap，或打开发布页手动下载。';
  if (/sha512|checksum|SHA512|INVALID_SIGNATURE|integrity/i.test(code + message)) return '更新文件校验失败，已停止安装。请重试下载或从发布页重新下载。';
  if (/timeout|timed out|ETIMEDOUT/i.test(code + message)) return '更新请求超时，请检查网络后重试。';
  if (/ENOTFOUND|ECONN|network|net::|403|429|5\d\d/i.test(code + message)) return '无法连接 GitHub 更新服务，请稍后重试或打开发布页下载。';
  return '更新操作失败，请重试或打开发布页手动下载。';
}

/** All transitions live in the main process. No renderer-supplied URLs or paths. */
export class UpdateService {
  private state: UpdateState;
  private downloadController?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: UpdateOptions) {
    this.state = { currentVersion: options.currentVersion, mode: options.mode, phase: 'idle', autoCheck: true, message: options.message || '从 GitHub Release 获取正式版更新。' };
  }
  get snapshot(): UpdateState { return structuredClone(this.state); }
  get isInstalling() { return this.state.phase === 'installing'; }
  private set(patch: Partial<UpdateState>) { this.state = { ...this.state, ...patch }; this.options.onState?.(this.snapshot); }
  async load() {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.options.settingsFile, 'utf8'));
      if (value && typeof value === 'object' && 'autoCheck' in value && typeof value.autoCheck === 'boolean') this.state.autoCheck = value.autoCheck;
    } catch { /* Missing or invalid preferences use the default. */ }
    return this.snapshot;
  }
  async saveAutoCheck(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('更新设置无效');
    const save = this.writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.options.settingsFile), { recursive: true });
      await fs.writeFile(this.options.settingsFile, JSON.stringify({ autoCheck: enabled }), 'utf8');
      this.set({ autoCheck: enabled });
      if (enabled) this.schedule(); else this.clearTimers();
      return this.snapshot;
    });
    this.writeQueue = save; return save;
  }
  schedule() {
    this.clearTimers();
    if (this.state.mode !== 'installer' || !this.state.autoCheck) return;
    const check = () => { if (this.state.autoCheck && ['idle', 'error'].includes(this.state.phase)) void this.check().catch(() => {}); };
    this.timer = setTimeout(check, 15000); this.timer.unref();
    this.interval = setInterval(check, 6 * 60 * 60 * 1000); this.interval.unref();
  }
  private clearTimers() { clearTimeout(this.timer); clearInterval(this.interval); }
  dispose() { this.clearTimers(); this.downloadController?.abort(); }
  private engine() {
    if (this.state.mode !== 'installer' || !this.options.engine) throw new Error(this.state.message);
    return this.options.engine;
  }
  private assertIdle() {
    if (['checking', 'downloading', 'installing'].includes(this.state.phase)) throw new Error('更新任务正在进行，请等待或取消下载');
  }
  async check() {
    const engine = this.engine(); this.assertIdle();
    if (this.state.phase === 'downloaded') throw new Error('更新已下载，请选择安装；无需重复检查');
    this.set({ phase: 'checking', error: undefined, progress: undefined, release: undefined, message: '正在检查 GitHub Release…' });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const release = await Promise.race([engine.check(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('update timeout')), this.options.checkTimeoutMs ?? 30000); })]);
      this.set({ phase: release ? 'available' : 'idle', release: release || undefined, checkedAt: new Date().toISOString(), message: release ? `发现新版本 ${release.version}` : '当前已是最新正式版。' });
    } catch (error) { this.set({ phase: 'error', error: updateError(error), message: '检查更新失败' }); }
    finally { clearTimeout(deadline); }
    return this.snapshot;
  }
  async download() {
    const engine = this.engine(); this.assertIdle();
    if (!this.state.release || !['available', 'error'].includes(this.state.phase)) throw new Error('请先检查并选择可用更新');
    const controller = new AbortController(); this.downloadController = controller;
    this.set({ phase: 'downloading', error: undefined, progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, message: '正在下载更新…' });
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.downloadTimeoutMs ?? 15 * 60 * 1000);
    try {
      await engine.download(controller.signal, value => {
        if (!controller.signal.aborted) this.set({ progress: { percent: Math.max(0, Math.min(100, Number(value.percent) || 0)), transferred: Math.max(0, Number(value.transferred) || 0), total: Math.max(0, Number(value.total) || 0), bytesPerSecond: Math.max(0, Number(value.bytesPerSecond) || 0) } });
      });
      if (controller.signal.aborted) throw new Error('cancelled');
      this.set({ phase: 'downloaded', progress: undefined, message: '更新已下载并完成校验，可以退出并安装。' });
    } catch (error) {
      if (controller.signal.aborted && !timedOut) this.set({ phase: 'available', progress: undefined, message: '下载已取消，可稍后重试。' });
      else this.set({ phase: 'error', progress: undefined, error: timedOut ? '下载超时，请重试。' : updateError(error), message: '下载更新失败' });
    } finally { clearTimeout(deadline); this.downloadController = undefined; }
    return this.snapshot;
  }
  cancel() {
    if (this.state.phase !== 'downloading' || !this.downloadController) throw new Error('当前没有可取消的更新下载');
    this.downloadController.abort(); return this.snapshot;
  }
  install() {
    const engine = this.engine();
    if (this.state.phase !== 'downloaded') throw new Error('请先下载并校验更新');
    if (!this.options.canInstall()) throw new Error('项目仍有 Git 或 AI 任务运行，请完成或取消后再安装更新');
    this.set({ phase: 'installing', error: undefined, message: '正在退出并启动安装程序…' });
    // Let the IPC response reach the renderer before the updater closes the windows.
    setImmediate(() => { try { engine.install(); } catch (error) { this.installFailed(error); } });
    return this.snapshot;
  }
  installFailed(error: unknown) { if (this.isInstalling) this.set({ phase: 'downloaded', error: updateError(error), message: '无法启动安装程序，请重试。' }); }
}
