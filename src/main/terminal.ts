import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { IPty } from 'node-pty';
import type { TerminalEvent, TerminalInfo, TerminalSnapshot } from '../shared/types';

const WINDOW = 256 * 1024, CHUNK = 32 * 1024;
interface Session {
  info: TerminalInfo; pty: IPty; history: string; pending: string;
  sequence: number; sent: number; acknowledged: number; paused: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
function size(value: unknown, min: number, max: number) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error('终端尺寸无效');
  return value as number;
}

/** Independent PTYs, scoped by repository and stable terminal tab key. */
export class TerminalService {
  private sessions = new Map<string, Session>();
  private closedKeys = new Map<string, Set<string>>();
  private native?: typeof import('node-pty');
  private disposed = false;
  constructor(private rootFor: (id: string) => string, private emit: (event: TerminalEvent) => void) {}
  get runningCount() { return [...this.sessions.values()].filter(session => session.info.running).length; }
  private find(sessionId: string, id: string) {
    this.rootFor(sessionId);
    const session = this.sessions.get(id);
    if (!session || session.info.sessionId !== sessionId) throw new Error('终端会话已结束，请重新启动');
    return session;
  }
  private slot(sessionId: string, terminalKey: string) {
    return [...this.sessions.values()].find(session => session.info.sessionId === sessionId && session.info.terminalKey === terminalKey);
  }
  private checkKey(sessionId: string, terminalKey: string) {
    this.rootFor(sessionId);
    if (typeof terminalKey !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(terminalKey)) throw new Error('终端标签标识无效');
    if (this.closedKeys.get(sessionId)?.has(terminalKey)) throw new Error('终端标签已关闭，请新建终端');
    if (this.disposed) throw new Error('应用正在退出');
  }
  async open(sessionId: string, cols: number, rows: number, terminalKey = 'default'): Promise<TerminalSnapshot> {
    size(cols, 2, 1000); size(rows, 1, 500);
    this.checkKey(sessionId, terminalKey);
    // Native loading stays lazy so a terminal failure never prevents opening Git.
    this.native ??= await import('node-pty');
    const cwd = this.rootFor(sessionId);
    this.checkKey(sessionId, terminalKey);
    let session = this.slot(sessionId, terminalKey);
    if (!session?.info.running) {
      let shell: string, args: string[];
      if (process.platform === 'win32') {
        const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell/7/pwsh.exe');
        shell = await access(pwsh).then(() => pwsh, () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'));
        // Unicode input/output; retain in-session history without writing commands to disk.
        const setup = '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine; Set-PSReadLineOption -HistorySaveStyle SaveNothing }';
        args = ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', Buffer.from(setup, 'utf16le').toString('base64')];
      } else {
        shell = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
        args = ['-l'];
      }
      // Another open request may have completed during shell discovery.
      this.checkKey(sessionId, terminalKey);
      session = this.slot(sessionId, terminalKey);
      if (!session?.info.running) {
        if (session) { this.sessions.delete(session.info.id); if (session.timer) clearTimeout(session.timer); }
        const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'HarborGit' };
        for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'HARBOR_USER_DATA', 'HARBOR_DEV_URL', 'HARBOR_TEST_HIDDEN']) delete (env as NodeJS.ProcessEnv)[key];
        const pty = this.native.spawn(shell, args, { cwd, cols, rows, name: 'xterm-256color', env, useConpty: true, useConptyDll: false });
        session = { info: { id: randomUUID(), sessionId, terminalKey, pid: pty.pid, shell: path.basename(shell), cwd, running: true }, pty, history: '', pending: '', sequence: 0, sent: 0, acknowledged: 0, paused: false };
        const current = session;
        this.sessions.set(current.info.id, current);
        pty.onData(data => {
          current.sequence += data.length; current.history = (current.history + data).slice(-WINDOW); current.pending += data;
          this.pressure(current); this.schedule(current);
        });
        pty.onExit(event => {
          current.info.running = false;
          this.flush(current, true);
          this.emit({ id: current.info.id, sessionId, terminalKey, kind: 'exit', exitCode: event.exitCode });
        });
      }
    }
    // Snapshot replay is an attachment checkpoint. Late events are deduplicated by sequence.
    if (session.timer) clearTimeout(session.timer); session.timer = undefined;
    session.pending = ''; session.sent = session.acknowledged = session.sequence;
    this.pressure(session);
    return { info: { ...session.info }, output: session.history, sequence: session.sequence };
  }
  private schedule(session: Session) {
    if (!session.timer) session.timer = setTimeout(() => { session.timer = undefined; this.flush(session); }, 12);
  }
  private pressure(session: Session) {
    if (!session.info.running) return;
    const queued = session.pending.length + session.sent - session.acknowledged;
    if (!session.paused && queued >= WINDOW) { session.pty.pause(); session.paused = true; }
    else if (session.paused && queued < WINDOW / 2) { session.pty.resume(); session.paused = false; }
  }
  private flush(session: Session, exiting = false) {
    if (session.timer) clearTimeout(session.timer); session.timer = undefined;
    if (!session.pending) return;
    const room = exiting ? session.pending.length : Math.max(0, WINDOW - (session.sent - session.acknowledged));
    let count = Math.min(exiting ? room : CHUNK, room, session.pending.length);
    if (count < session.pending.length && /[\uD800-\uDBFF]/.test(session.pending[count - 1] || '')) count--;
    if (count > 0) {
      const data = session.pending.slice(0, count); session.pending = session.pending.slice(count); session.sent += count;
      this.emit({ id: session.info.id, sessionId: session.info.sessionId, terminalKey: session.info.terminalKey, kind: 'data', data, sequence: session.sent });
    }
    this.pressure(session);
    if (session.pending && room > count && count > 0) this.schedule(session);
  }
  input(sessionId: string, id: string, data: unknown) {
    const session = this.find(sessionId, id);
    if (typeof data !== 'string' || data.length > 64 * 1024) throw new Error('终端输入过长');
    if (!session.info.running) throw new Error('终端已退出');
    session.pty.write(data);
  }
  resize(sessionId: string, id: string, cols: number, rows: number) {
    const session = this.find(sessionId, id); size(cols, 2, 1000); size(rows, 1, 500);
    if (session.info.running && (session.pty.cols !== cols || session.pty.rows !== rows)) session.pty.resize(cols, rows);
  }
  acknowledge(sessionId: string, id: string, sequence: number) {
    const session = this.find(sessionId, id);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > session.sent) return;
    session.acknowledged = Math.max(session.acknowledged, sequence); this.pressure(session);
    if (session.pending) this.schedule(session);
  }
  validate(sessionId: string, id: string) { this.find(sessionId, id); }
  stop(sessionId: string, id?: string) {
    const targets = [...this.sessions.values()].filter(session => session.info.sessionId === sessionId && (!id || session.info.id === id));
    for (const session of targets) {
      this.sessions.delete(session.info.id);
      if (session.timer) clearTimeout(session.timer);
      if (session.info.running) { session.info.running = false; session.pty.kill(); }
    }
    if (!id) this.closedKeys.delete(sessionId);
    return targets.length > 0;
  }
  close(sessionId: string, terminalKey: string) {
    this.rootFor(sessionId);
    if (typeof terminalKey !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(terminalKey)) throw new Error('终端标签标识无效');
    const keys = this.closedKeys.get(sessionId) || new Set<string>(); keys.add(terminalKey); this.closedKeys.set(sessionId, keys);
    const session = this.slot(sessionId, terminalKey);
    // The tombstone also cancels an open that is still awaiting native/shell discovery.
    if (session) this.stop(sessionId, session.info.id);
    return true;
  }
  dispose() { this.disposed = true; for (const id of new Set([...this.sessions.values()].map(session => session.info.sessionId))) this.stop(id); this.closedKeys.clear(); }
}
