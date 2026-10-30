import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { Activity, Branch, Commit, CommitFile, Conflict, Diff, Failure, FileChange, Remote, Repository, RepositoryOperation, RebaseSavedChanges, Requests, Responses, MergeWorkspace, MergeIntoResult, StagedSnapshot, AiSuggestion } from '../shared/types';

export class GitError extends Error {
  readonly details: Failure;
  constructor(details: Failure) { super(details.message); this.name = 'GitError'; this.details = details; }
}
export interface GitOptions { onActivity?: (event: Activity) => void; gitPath?: string; timeoutMs?: number; outputLimit?: number; mergeWorkspaceRoot?: string; generateMessage?: (snapshot: StagedSnapshot, signal: AbortSignal) => Promise<string>; }
interface CommandResult { stdout: string; stderr: string; code: number; truncated: boolean; }
interface RunOptions { accepted?: number[]; input?: string; limit?: number; timeout?: number; authenticate?: boolean; }
interface OperationState { gitDir: string; operation?: RepositoryOperation; unsupported?: string; originalHead?: string; commits?: string[]; }
interface TreePath { path: string; mode: string; }
interface SavedRebaseRecord extends RebaseSavedChanges {
  version: 1; token: string; originalHead: string; sourceHead: string; stashOid?: string;
  saveCompleted?: boolean; rebaseStarted?: boolean; restoreHead?: string;
  applyAttempted?: boolean; applyInProgress?: boolean; beforeFingerprint?: string; invalidRef?: boolean;
}
const MAX_TEXT = 2 * 1024 * 1024;
const scrub = (s: string) => s.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@');
const text = (v: unknown, label: string, max = 4096): string => {
  if (typeof v !== 'string' || !v.length || v.includes('\0') || v.length > max) throw new GitError({ message: `${label}无效` });
  return v;
};
function filePath(v: unknown): string {
  const p = text(v, '文件路径');
  if (path.isAbsolute(p) || /^[a-z]:/i.test(p) || p.includes('\\') || p.split('/').some(s => s === '..' || s.toLowerCase() === '.git') || p === '.') throw new GitError({ message: '仅允许仓库内的相对文件路径' });
  return p;
}
function ref(v: unknown, label = '分支名称'): string {
  const s = text(v, label, 1024);
  if (s.startsWith('-') || s.startsWith('/') || s.endsWith('/') || s.includes('..') || s.includes('@{') || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(s)) throw new GitError({ message: `${label}无效` });
  return s;
}
function remoteUrl(v: unknown): string {
  const url = text(v, '仓库地址').trim();
  if (!url || url.startsWith('-') || /[\x00-\x1f\x7f]/.test(url) || /^(?:ext|fd):/i.test(url) || /^[a-z][a-z0-9+.-]*::/i.test(url)) throw new GitError({ message: '仓库地址或协议无效' });
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new GitError({ message: '仓库地址格式无效' }); }
    if (!['https:', 'http:', 'ssh:', 'git:', 'file:'].includes(parsed.protocol)) throw new GitError({ message: '请使用 HTTPS、SSH、Git 或本地仓库地址' });
    if (['https:', 'http:'].includes(parsed.protocol) && (parsed.username || parsed.password)) throw new GitError({ message: '请移除地址中的用户名或 Token，通过系统凭据管理器登录' });
  }
  return url;
}
function failureMessage(output: string): string {
  if (/cannot prompt because user interactivity has been disabled|could not read (?:Username|Password)|terminal prompts disabled|authentication failed|invalid username or (?:password|token)|password authentication is not supported/i.test(output)) return '远程仓库认证失败。请在系统 Git 凭据管理器的登录窗口完成授权后重试；若未出现窗口，请检查 Git for Windows 是否安装并启用了 Git Credential Manager。也可在远程仓库设置中改用已配置密钥的 SSH 地址。';
  if (/permission denied \(publickey/i.test(output)) return 'SSH 认证失败，请确认本机 SSH 密钥已添加到远程平台，并且当前账号有权访问该仓库。';
  return output;
}
const hash = (v: unknown) => { const s = text(v, '提交 ID', 64); if (!/^[0-9a-f]{7,64}$/i.test(s)) throw new GitError({ message: '提交 ID 无效' }); return s; };
function names(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.length > 10000) throw new GitError({ message: '请选择文件' });
  return [...new Set(v.map(filePath))];
}
function parseStatus(raw: string): Pick<Repository, 'branch' | 'head' | 'unborn' | 'detached' | 'upstream' | 'ahead' | 'behind' | 'entries'> {
  let branch = '', head = '', upstream = '', ahead = 0, behind = 0;
  const entries: FileChange[] = [], records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.startsWith('# branch.oid ')) head = r.slice(13);
    else if (r.startsWith('# branch.head ')) branch = r.slice(14);
    else if (r.startsWith('# branch.upstream ')) upstream = r.slice(18);
    else if (r.startsWith('# branch.ab ')) { const m = r.match(/\+(\d+) -(\d+)/); if (m) { ahead = +m[1]; behind = +m[2]; } }
    else if (r.startsWith('? ')) entries.push({ path: r.slice(2), index: ' ', worktree: '?', conflict: false });
    else if (/^[12u] /.test(r)) {
      const f = r.split(' '), type = f[0];
      const p = f.slice(type === '1' ? 8 : type === '2' ? 9 : 10).join(' ');
      const entry: FileChange = { path: p, index: f[1][0].replace('.', ' '), worktree: f[1][1].replace('.', ' '), conflict: type === 'u' };
      if (type === '2') entry.originalPath = records[++i];
      entries.push(entry);
    }
  }
  return { branch, head: head === '(initial)' ? '' : head, unborn: head === '(initial)', detached: branch === '(detached)', upstream, ahead, behind, entries };
}

/** The only Git process boundary. No shell is used. Each request is serialized. */
export class GitService {
  private root = '';
  private queue: Promise<unknown> = Promise.resolve();
  private running = new Map<string, { child: ChildProcess; stop: (reason: string) => void }>();
  private aiTasks = new Map<string, AbortController>();
  private managingRebaseSave = false;
  pendingCount = 0;
  get repositoryRoot() { return this.root; }
  constructor(private options: GitOptions = {}) {}
  cancel(id: string): boolean { const ai = this.aiTasks.get(id); if (ai) { ai.abort(); return true; } const job = this.running.get(id); if (!job) return false; job.stop('操作已取消，请刷新状态确认已完成的部分'); return true; }
  cancelAll() { for (const id of [...this.running.keys(), ...this.aiTasks.keys()]) this.cancel(id); }
  request<K extends keyof Requests>(operation: K, payload: Requests[K]): Promise<Responses[K]> {
    this.pendingCount++;
    const task = this.queue.then(() => this.dispatch(operation, payload));
    this.queue = task.catch(() => undefined);
    return task.finally(() => { this.pendingCount--; }) as Promise<Responses[K]>;
  }
  private emit(e: Activity) { this.options.onActivity?.(e); }
  private run(cwd: string, args: string[], opts: RunOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(), command = scrub(`git ${args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`);
      const now = () => new Date().toISOString();
      const limit = opts.limit ?? this.options.outputLimit ?? 16 * 1024 * 1024;
      let stopped = '', spawnError = '', stdoutSize = 0, stderrSize = 0, truncated = false;
      const out: Buffer[] = [], err: Buffer[] = [];
      const child = spawn(this.options.gitPath ?? 'git', ['--no-pager', '--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], {
        cwd, shell: false, windowsHide: true,
        // Git has no terminal here. Network actions may use the helper's GUI/browser.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: opts.authenticate ? 'auto' : 'Never', GCM_GUI_PROMPT: opts.authenticate ? 'true' : 'false', GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_PAGER: 'cat', LC_ALL: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const stop = (reason: string) => {
        if (stopped) return;
        stopped = reason;
        if (process.platform === 'win32' && child.pid) {
          // Kill Git and its transport/helper/hook children together, without a shell.
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
          killer.on('exit', code => { if (code !== 0) child.kill(); });
        } else child.kill('SIGTERM');
      };
      this.running.set(id, { child, stop });
      this.emit({ id, command, kind: 'start', text: '', time: now() });
      const timer = setTimeout(() => stop('Git 操作超时，请检查网络、凭据或 Git hook 后重试'), opts.timeout ?? this.options.timeoutMs ?? 180000);
      const capture = (data: Buffer, target: Buffer[], size: number) => {
        if (size < limit) target.push(data.subarray(0, limit - size));
        if (size + data.length > limit) truncated = true;
      };
      child.stdout.on('data', (data: Buffer) => { capture(data, out, stdoutSize); stdoutSize += data.length; });
      child.stderr.on('data', (data: Buffer) => {
        capture(data, err, stderrSize); stderrSize += data.length;
        this.emit({ id, command, kind: 'progress', text: scrub(data.toString('utf8').slice(-4000)), time: now() });
      });
      child.on('error', e => { spawnError = e.message; });
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.input);
      let settled = false;
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); this.running.delete(id);
        const stdout = Buffer.concat(out).toString('utf8'), stderr = scrub(Buffer.concat(err).toString('utf8'));
        this.emit({ id, command, kind: 'finish', text: stopped || spawnError || stderr.slice(-2000), time: now(), exitCode: code ?? -1 });
        if (stopped || spawnError || !(opts.accepted ?? [0]).includes(code ?? -1)) {
          reject(new GitError({ message: stopped || (spawnError ? `无法启动 Git。请安装 Git for Windows 并将 git.exe 加入 PATH。${spawnError}` : failureMessage(stderr.trim().slice(-4000) || scrub(stdout).trim().slice(-4000) || `Git 命令失败 (${code})`)), command, code: code ?? -1, stderr, stdout: scrub(stdout), cancelled: !!stopped }));
        } else resolve({ stdout, stderr, code: code!, truncated });
      };
      child.on('exit', code => {
        if (stopped) {
          // MSYS hooks/transports can inherit pipe handles beyond Git's lifetime.
          // The process tree has been terminated; do not wait for those handles.
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
          finish(code);
        }
      });
      child.on('close', finish);
    });
  }
  private git(args: string[], opts?: RunOptions) { if (!this.root) throw new GitError({ message: '请先打开仓库' }); return this.run(this.root, args, opts); }
  private async hasHead() { return (await this.git(['rev-parse', '--verify', 'HEAD'], { accepted: [0, 128] })).code === 0; }
  private async snapshot(): Promise<Repository> {
    const result = await this.git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']);
    if (result.truncated) throw new GitError({ message: '仓库状态超过 16 MiB 读取上限，无法完整展示' });
    const status = parseStatus(result.stdout);
    const mergePath = (await this.git(['rev-parse', '--git-path', 'MERGE_HEAD'])).stdout.trim();
    const mergeInProgress = await fs.access(path.resolve(this.root, mergePath)).then(() => true, () => false);
    const userName = (await this.git(['config', '--get', 'user.name'], { accepted: [0, 1] })).stdout.trim();
    const userEmail = (await this.git(['config', '--get', 'user.email'], { accepted: [0, 1] })).stdout.trim();
    const operationState = await this.operationState();
    const saved = await this.savedRebaseRecord(operationState, { head: status.head, branch: status.branch });
    return { root: this.root, ...status, mergeInProgress, userName, userEmail, operation: operationState.operation, historyBackup: await this.historyBackup(operationState.gitDir), rebaseSavedChanges: saved && this.publicSavedChanges(saved), mergeWorkspace: await this.mergeMetadata() };
  }
  /** State belongs to a Git worktree, not necessarily root/.git (which can be a file). */
  private async operationState(): Promise<OperationState> {
    const gitDir = (await this.git(['rev-parse', '--absolute-git-dir'])).stdout.trim();
    const read = async (...parts: string[]) => {
      try { return (await fs.readFile(path.join(gitDir, ...parts), 'utf8')).trim(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return ''; throw e; }
    };
    const exists = async (...parts: string[]) => fs.access(path.join(gitDir, ...parts)).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; });
    const merge = await exists('rebase-merge'), apply = !merge && await exists('rebase-apply');
    if (merge || apply) {
      const dir = merge ? 'rebase-merge' : 'rebase-apply';
      if (apply && !await exists(dir, 'rebasing') && !await exists(dir, 'head-name')) return { gitDir, unsupported: 'git am' };
      const [branch, onto, original, oldOriginal, step, total, rebaseHead, stopped] = await Promise.all([
        read(dir, 'head-name'), read(dir, 'onto'), read(dir, 'orig-head'), read(dir, 'orig_head'),
        read(dir, merge ? 'msgnum' : 'next'), read(dir, merge ? 'end' : 'last'),
        read('REBASE_HEAD'), read(dir, 'stopped-sha'),
      ]);
      const number = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
      const commit = rebaseHead || stopped;
      return { gitDir, originalHead: original || oldOriginal || undefined, operation: { kind: 'rebase', branch: branch.replace(/^refs\/heads\//, '') || undefined, onto: /^[0-9a-f]{40,64}$/i.test(onto) ? onto : undefined, commit: /^[0-9a-f]{7,64}$/i.test(commit) ? commit : undefined, step: number(step), total: number(total) } };
    }
    const [revertHead, cherry, sequencer, todo, original, bisect] = await Promise.all([
      read('REVERT_HEAD'), exists('CHERRY_PICK_HEAD'), exists('sequencer'), read('sequencer', 'todo'), read('sequencer', 'head'), exists('BISECT_START'),
    ]);
    if (cherry) return { gitDir, unsupported: 'cherry-pick' };
    const commands = todo.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
    if (revertHead || (sequencer && commands.length > 0 && commands.every(line => /^revert\s/.test(line)))) {
      const commit = revertHead || commands[0]?.split(/\s+/)[1];
      const commits = [...new Set([revertHead, ...commands.map(line => line.split(/\s+/)[1])].filter(value => value && /^[0-9a-f]{7,64}$/i.test(value)))];
      return { gitDir, originalHead: original || undefined, commits, operation: { kind: 'revert', commit: commit && /^[0-9a-f]{7,64}$/i.test(commit) ? commit : undefined } };
    }
    if (sequencer) return { gitDir, unsupported: 'Git sequencer' };
    if (bisect) return { gitDir, unsupported: 'bisect' };
    return { gitDir };
  }
  private async historyBackup(gitDir: string): Promise<string | undefined> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(path.join(gitDir, 'harborgit-history-backup.json'), 'utf8'));
      const reference = value && typeof value === 'object' && 'ref' in value ? (value as { ref: unknown }).ref : undefined;
      if (typeof reference !== 'string' || !/^refs\/harborgit\/backups\/[a-zA-Z0-9-]+$/.test(reference)) return undefined;
      const result = await this.git(['rev-parse', '--verify', `${reference}^{commit}`], { accepted: [0, 128] });
      return result.code === 0 ? reference : undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return undefined;
      throw e;
    }
  }
  private async saveHistoryBackup(state: Repository, operation: string) {
    const gitDir = (await this.git(['rev-parse', '--absolute-git-dir'])).stdout.trim();
    const reference = `refs/harborgit/backups/${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}`;
    // This ref preserves committed history only. It is deliberately not called a WIP backup.
    await this.git(['update-ref', '--create-reflog', '-m', `HarborGit before ${operation}`, reference, state.head]);
    const target = path.join(gitDir, 'harborgit-history-backup.json'), temporary = `${target}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify({ ref: reference, head: state.head, sourceBranch: state.branch, operation, createdAt: new Date().toISOString() }), 'utf8'); await fs.rename(temporary, target); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return reference;
  }
  private publicSavedChanges(record: SavedRebaseRecord): RebaseSavedChanges {
    const { ref, originalBranch, sourceBranch, status, message } = record;
    return { ref, originalBranch, sourceBranch, status, message };
  }
  private async manageRebaseSave<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.managingRebaseSave; this.managingRebaseSave = true;
    try { return await action(); } finally { this.managingRebaseSave = previous; }
  }
  private async readSavedRecord(gitDir: string): Promise<SavedRebaseRecord | undefined> {
    let value: SavedRebaseRecord;
    try { value = JSON.parse(await fs.readFile(path.join(gitDir, 'harborgit-rebase-save.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new GitError({ message: '变基改动保存记录无法读取，请保留 Git 元数据并在外部检查，未执行新的写操作' }); }
    const oid = (v: unknown) => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(v);
    if (!value || value.version !== 1 || typeof value.token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.token) || value.ref !== `refs/harborgit/wip/${value.token}` || !oid(value.originalHead) || !oid(value.sourceHead) || !['saving', 'saved', 'restore-pending', 'restore-conflicts', 'restored'].includes(value.status) || typeof value.message !== 'string' || (value.stashOid !== undefined && !oid(value.stashOid)) || (value.restoreHead !== undefined && !oid(value.restoreHead))) throw new GitError({ message: '变基改动保存记录无效，未执行新的写操作；请保留备份并在外部检查' });
    ref(value.originalBranch, '原工作区分支'); ref(value.sourceBranch, '变基源分支');
    return value;
  }
  private async writeSavedRecord(gitDir: string, record: SavedRebaseRecord) {
    const target = path.join(gitDir, 'harborgit-rebase-save.json'), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await fs.open(temporary, 'wx');
      try { await file.writeFile(JSON.stringify(record), 'utf8'); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private saveMarker(record: SavedRebaseRecord) { return `HarborGit rebase autosave ${record.token}`; }
  private async verifySavedStash(record: SavedRebaseRecord, id: string) {
    const subject = (await this.git(['show', '--no-patch', '--format=%s', id])).stdout.trim();
    const parents = await this.parents(id);
    if (!subject.endsWith(this.saveMarker(record)) || parents.length < 2 || parents.length > 3 || parents[0] !== record.originalHead) throw new GitError({ message: '无法确认该保存对象属于本次操作，未恢复或改写任何内容' });
    return parents;
  }
  private async findSavedStash(record: SavedRebaseRecord): Promise<string | undefined> {
    const result = await this.git(['stash', 'list', '-z', '--format=%H%x00%s']);
    if (result.truncated) throw new GitError({ message: 'Stash 列表过大，无法安全确认本次保存对象，请保留全部 Stash 并在外部检查' });
    const fields = result.stdout.split('\0'), candidates = new Set<string>();
    for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i + 1].endsWith(this.saveMarker(record)) && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(fields[i])) {
      try { await this.verifySavedStash(record, fields[i]); candidates.add(fields[i]); } catch (e) { if (e instanceof GitError && !e.details.cancelled) continue; throw e; }
    }
    if (candidates.size > 1) throw new GitError({ message: '发现多个相同保存标识的对象，无法安全选择；未应用或删除任何 Stash' });
    return [...candidates][0];
  }
  private async bindSavedRef(record: SavedRebaseRecord, id: string) {
    await this.verifySavedStash(record, id);
    const existing = await this.git(['rev-parse', '--verify', `${record.ref}^{commit}`], { accepted: [0, 128] });
    if (existing.code === 0) {
      if (existing.stdout.trim() !== id) throw new GitError({ message: '本次 WIP 备份引用已被外部改动，未覆盖该引用或应用任何内容' });
    } else await this.git(['update-ref', '--create-reflog', '-m', this.saveMarker(record), record.ref, id, '0'.repeat(id.length)]);
    record.stashOid = id; record.invalidRef = false;
  }
  private async savedRebaseRecord(active: OperationState, current?: { head: string; branch: string }): Promise<SavedRebaseRecord | undefined> {
    const record = await this.readSavedRecord(active.gitDir);
    if (!record || record.status === 'restored' || this.managingRebaseSave) return record;
    let changed = false;
    try {
      if (!record.stashOid || record.status === 'saving') {
        const id = record.stashOid || await this.findSavedStash(record);
        if (id) {
          await this.bindSavedRef(record, id); record.status = 'restore-pending';
          record.message = '保存过程曾中断，已通过唯一标识找回本次 WIP 备份。未执行新的变基或自动重复恢复，请检查工作区后选择恢复。'; changed = true;
        } else {
          record.status = 'restore-pending'; record.message = '保存过程未完成，尚未确认可用的 WIP 对象。未开始新的变基，请检查原文件与 Stash；处理完成后可结束恢复。'; changed = true;
        }
      } else {
        await this.bindSavedRef(record, record.stashOid);
      }
      if (record.applyInProgress) {
        record.applyInProgress = false; record.status = 'restore-pending';
        record.message = '上次恢复过程被中断，可能已部分写入。备份保留；请检查文件，只有确认工作区完全未变时才可选择不保留暂存状态重试，否则请手工处理后确认完成。'; changed = true;
      } else if (record.status === 'saved' && !active.operation && !active.unsupported) {
        record.status = 'restore-pending';
        record.message = '变基已结束或保存后任务被中断；原改动仍在专用备份中，请确认后恢复，程序不会盲目重复应用。'; changed = true;
      }
      if (!record.restoreHead && !active.operation && current && (record.originalBranch !== record.sourceBranch || (current.branch === record.originalBranch && current.head === record.originalHead))) {
        record.restoreHead = record.originalHead; changed = true;
      }
    } catch (e) {
      record.status = 'restore-pending'; record.invalidRef = true;
      record.message = `保存备份需要人工检查：${e instanceof Error ? e.message : String(e)}。未应用或删除任何 Stash，禁止自动恢复。`; changed = true;
    }
    if (changed) await this.writeSavedRecord(active.gitDir, record);
    return record;
  }
  private async beginRebaseSave(state: Repository, sourceBranch: string, sourceHead: string): Promise<SavedRebaseRecord> {
    const active = await this.operationState(), token = randomUUID();
    const record: SavedRebaseRecord = { version: 1, token, ref: `refs/harborgit/wip/${token}`, originalBranch: state.branch, originalHead: state.head, sourceBranch, sourceHead, status: 'saving', message: '正在保存本次变基前的暂存区、工作区和未跟踪文件；忽略内容不收进备份。' };
    // The durable intent precedes the only command that moves WIP out of the tree.
    await this.writeSavedRecord(active.gitDir, record);
    try {
      // Stash internally uses generated pathspecs when cleaning untracked files.
      // Global --literal-pathspecs breaks that cleanup in Git for Windows. This
      // command has no user pathspec, so let stash interpret its own pathspecs.
      await this.git(['--no-literal-pathspecs', '-c', 'submodule.recurse=false', 'stash', 'push', '--include-untracked', '--message', this.saveMarker(record)]);
      const id = await this.findSavedStash(record);
      if (!id) throw new GitError({ message: '未找到可确认归属的保存对象，未开始变基，请检查原工作区改动' });
      await this.bindSavedRef(record, id); record.saveCompleted = true; record.status = 'saved';
      record.message = `原 ${record.originalBranch} 的改动已保存到专用 WIP 备份；变基暂停时不会将其应用到其他分支。`;
      await this.writeSavedRecord(active.gitDir, record);
      return record;
    } catch (error) {
      try { const id = record.stashOid || await this.findSavedStash(record); if (id) { await this.bindSavedRef(record, id); record.status = 'restore-pending'; } }
      catch { /* Keep the intent; a later snapshot can find the unique token again. */ }
      record.message = '保存改动失败或被取消，未开始变基。请检查当前文件与保存备份；不要重复应用已部分恢复的内容。';
      await this.writeSavedRecord(active.gitDir, record);
      throw error;
    }
  }
  private async savedPaths(record: SavedRebaseRecord): Promise<{ paths: string[]; untracked: string[]; parents: string[] }> {
    if (!record.stashOid || record.invalidRef) throw new GitError({ message: '尚未确认本次 WIP 备份，不能自动恢复' });
    await this.bindSavedRef(record, record.stashOid);
    const parents = await this.verifySavedStash(record, record.stashOid), paths = new Set<string>();
    for (const endpoint of [record.stashOid, parents[1]]) {
      const result = await this.git(['diff', '--name-only', '-z', '--no-renames', parents[0], endpoint]);
      if (result.truncated) throw new GitError({ message: '保存改动路径过多，无法安全恢复，请保留备份并在外部处理' });
      for (const p of result.stdout.split('\0').filter(Boolean)) paths.add(filePath(p));
    }
    const untracked = parents[2] ? (await this.treePaths(parents[2])).map(entry => entry.path) : [];
    for (const p of untracked) paths.add(p);
    return { paths: [...paths].sort(), untracked, parents };
  }
  private async savedFingerprint(paths: string[]): Promise<string> {
    const combined = createHash('sha256');
    for (const p of paths) {
      await this.safeWritePath(p);
      const target = path.join(this.root, p), stat = await fs.lstat(target).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
      combined.update(p + '\0');
      if (!stat) { combined.update('missing\0'); continue; }
      const digest = await new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256'), stream = createReadStream(target);
        stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex')));
      });
      combined.update('file:' + digest + '\0');
    }
    return combined.digest('hex');
  }
  private async noteRebaseSaveFailure(record: SavedRebaseRecord, error: unknown) {
    const active = await this.operationState(), state = await this.snapshot();
    record.status = active.operation?.kind === 'rebase' ? 'saved' : 'restore-pending';
    if (!active.operation) record.restoreHead = record.originalBranch === record.sourceBranch && state.branch === record.originalBranch ? state.head : record.originalHead;
    record.message = active.operation?.kind === 'rebase' ? '变基已暂停或被中断；原改动仍在专用备份中，继续或中止变基后再恢复。' : `变基任务未完成：${error instanceof Error ? error.message : String(error)}。原改动备份保留，请确认后恢复，不会自动重放。`;
    await this.writeSavedRecord(active.gitDir, record);
  }
  private async restoreRebaseSaved(record: SavedRebaseRecord, preserveIndex: boolean, automatic = false): Promise<Repository> {
    const active = await this.operationState();
    try {
      if (active.operation || active.unsupported) throw new GitError({ message: '请先完成或中止当前 Git 操作，再恢复保存改动' });
      let state = await this.snapshot();
      if (state.mergeInProgress || state.entries.length) throw new GitError({ message: '恢复前工作区和暂存区必须干净，不能覆盖当前改动或重复应用已有冲突' });
      if (await fs.access(path.join(active.gitDir, 'index.lock')).then(() => true, () => false)) throw new GitError({ message: 'Git 索引仍被其他任务占用，请等待后再恢复' });
      const originalRef = `refs/heads/${record.originalBranch}`, originalHead = (await this.git(['rev-parse', '--verify', `${originalRef}^{commit}`])).stdout.trim();
      const expected = record.originalBranch === record.sourceBranch ? record.restoreHead || record.originalHead : record.originalHead;
      if (originalHead !== expected) throw new GitError({ message: `原 ${record.originalBranch} 分支已被外部改动，未切换或恢复；请在外部核对专用备份` });
      if (![record.originalBranch, record.sourceBranch].includes(state.branch)) throw new GitError({ message: `当前分支不是本次记录的源分支或原 ${record.originalBranch}，未恢复到错误分支` });
      const saved = await this.savedPaths(record);
      // This also rejects ignored blockers and special file modes in the saved trees.
      await this.safeTreeWrites([state.head, originalHead, record.stashOid!, saved.parents[1], ...(saved.parents[2] ? [saved.parents[2]] : [])], 'sequencer');
      if (state.branch !== record.originalBranch) {
        const trees = await this.git(['worktree', 'list', '--porcelain', '-z']);
        if (trees.truncated || trees.stdout.split('\0\0').some(tree => tree.split('\0').includes(`branch ${originalRef}`))) throw new GitError({ message: `原 ${record.originalBranch} 分支在其他工作区被占用，备份保留，未切换` });
        await this.git(['switch', record.originalBranch]); state = await this.snapshot();
      }
      if (state.branch !== record.originalBranch || state.head !== expected || state.entries.length) throw new GitError({ message: '恢复目标分支或版本已变化，未应用保存改动' });
      for (const p of saved.untracked) if (await fs.lstat(path.join(this.root, p)).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return false; throw e; })) throw new GitError({ message: `保存的未跟踪文件 ${p} 已有同名内容，未覆盖该文件` });
      const fingerprint = await this.savedFingerprint(saved.paths);
      const indexTree = (await this.git(['write-tree'])).stdout.trim(), headTree = (await this.git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
      if (indexTree !== headTree) throw new GitError({ message: '当前暂存区不是干净的 HEAD，未应用保存改动' });
      if (record.applyAttempted && (preserveIndex || !record.beforeFingerprint || record.beforeFingerprint !== fingerprint)) throw new GitError({ message: '上次恢复可能已部分应用，禁止重复应用；请手工处理后确认完成' });
      record.beforeFingerprint = fingerprint; record.applyAttempted = true; record.applyInProgress = true; record.status = 'restore-pending';
      record.message = `正在向原 ${record.originalBranch} 恢复改动，专用备份与 Stash 均保留。`;
      await this.writeSavedRecord(active.gitDir, record);
      try {
        await this.git(['--no-literal-pathspecs', '-c', 'submodule.recurse=false', 'stash', 'apply', ...(preserveIndex ? ['--index'] : []), record.ref]);
        record.applyInProgress = false; record.status = 'restored';
        record.message = `${record.sourceBranch !== record.originalBranch ? `源分支 ${record.sourceBranch} 的变基任务已结束，并已切回原 ${record.originalBranch}；` : ''}已恢复原改动${preserveIndex ? '及暂存状态' : '到工作区（未保留原暂存状态）'}。专用 WIP 备份和 Stash 条目继续保留。`;
        await this.writeSavedRecord(active.gitDir, record); return this.snapshot();
      } catch (error) {
        record.applyInProgress = false;
        const after = await this.snapshot();
        record.status = after.entries.some(file => file.conflict) ? 'restore-conflicts' : 'restore-pending';
        let untouched = false;
        if (!(error instanceof GitError && error.details.cancelled) && !after.entries.length && after.branch === record.originalBranch && after.head === expected) {
          const currentIndex = (await this.git(['write-tree'])).stdout.trim();
          untouched = currentIndex === headTree && await this.savedFingerprint(saved.paths) === fingerprint;
        }
        if (untouched) record.applyAttempted = false;
        record.message = untouched ? '保留暂存状态的恢复未完成，但已确认工作区与索引未被部分修改。备份保留，可重试，或明确选择不保留暂存状态恢复。' : '恢复失败、被取消或产生冲突，可能已有部分内容写入。专用备份和 Stash 保留，禁止重复应用；请处理现有文件并确认完成。';
        await this.writeSavedRecord(active.gitDir, record); return this.snapshot();
      }
    } catch (error) {
      if (record.status !== 'restore-conflicts') record.status = 'restore-pending';
      record.message = `${automatic ? '自动恢复暂停：' : '未恢复：'}${error instanceof Error ? error.message : String(error)}。专用 WIP 备份和 Stash 均保留。`;
      await this.writeSavedRecord(active.gitDir, record); return this.snapshot();
    }
  }
  private async completeRebaseSave(record: SavedRebaseRecord, state: Repository) {
    if (state.operation?.kind === 'rebase') return state;
    record.status = 'restore-pending';
    record.restoreHead = record.originalBranch === record.sourceBranch ? state.head : record.originalHead;
    record.message = '变基任务已结束，准备恢复原工作区改动，备份保留。';
    const active = await this.operationState(); await this.writeSavedRecord(active.gitDir, record);
    return this.restoreRebaseSaved(record, true, true);
  }
  private async rebaseSavedAction(action: unknown): Promise<Repository> {
    return this.manageRebaseSave(async () => {
      if (!['restore', 'restore-unstaged', 'finish'].includes(action as string)) throw new GitError({ message: '保存改动恢复操作无效' });
      const active = await this.operationState(), record = await this.readSavedRecord(active.gitDir);
      if (!record || record.status === 'restored') throw new GitError({ message: '没有待处理的变基保存改动' });
      if (action !== 'finish') return this.restoreRebaseSaved(record, action === 'restore');
      const state = await this.snapshot();
      if (active.operation || active.unsupported || state.mergeInProgress || state.entries.some(file => file.conflict)) throw new GitError({ message: '请先完成当前 Git 操作并处理全部未合并文件，再确认恢复处理完成' });
      record.status = 'restored'; record.applyInProgress = false;
      record.message = '用户已确认手工处理完成；程序未声称全部改动已自动恢复。已有 WIP 引用和 Stash 条目继续保留。';
      await this.writeSavedRecord(active.gitDir, record); return this.snapshot();
    });
  }
  private async expectedHead(expected: unknown, state: Repository) {
    if (typeof expected !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(expected) || expected.toLowerCase() !== state.head.toLowerCase()) throw new GitError({ message: 'HEAD 已变化或确认版本无效，请刷新后重新选择操作' });
    const current = (await this.git(['rev-parse', '--verify', 'HEAD'])).stdout.trim();
    if (current.toLowerCase() !== expected.toLowerCase()) throw new GitError({ message: 'HEAD 已变化，请刷新后重新选择操作' });
  }
  private async requireNoOperation(state: Repository, requireBranch = true) {
    const active = await this.operationState();
    if (active.operation || active.unsupported || state.mergeInProgress || state.entries.some(file => file.conflict)) throw new GitError({ message: `请先完成或中止当前${active.operation?.kind === 'rebase' ? '变基' : active.operation?.kind === 'revert' ? '撤销提交' : active.unsupported || '合并/冲突'}操作` });
    if (state.unborn || (requireBranch && state.detached)) throw new GitError({ message: '此操作需要正常的已提交本地分支' });
    if (state.mergeWorkspace) throw new GitError({ message: '请先完成并关闭临时合并工作区，再执行历史操作' });
  }
  private async requireAncestor(target: string, head: string) {
    if ((await this.git(['merge-base', '--is-ancestor', target, head], { accepted: [0, 1] })).code !== 0) throw new GitError({ message: '所选提交不在当前 HEAD 的祖先历史中，请刷新后选择当前分支历史中的提交' });
  }
  private async indexPaths(): Promise<TreePath[]> {
    const result = await this.git(['ls-files', '--stage', '-z']);
    if (result.truncated) throw new GitError({ message: '索引过大，无法完整验证文件安全性' });
    return result.stdout.split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t');
      if (tab < 0) throw new GitError({ message: '无法解析索引路径，未修改文件' });
      return { mode: record.slice(0, tab).split(' ')[0], path: filePath(record.slice(tab + 1)) };
    });
  }
  private async treePaths(id: string): Promise<TreePath[]> {
    const result = await this.git(['ls-tree', '-r', '-z', '--full-tree', id]);
    if (result.truncated) throw new GitError({ message: '提交文件树过大，无法完整验证文件安全性' });
    return result.stdout.split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t');
      if (tab < 0) throw new GitError({ message: '无法解析提交文件树，未修改文件' });
      return { mode: record.slice(0, tab).split(' ')[0], path: filePath(record.slice(tab + 1)) };
    });
  }
  private async untrackedPaths(ignoredOnly?: boolean): Promise<string[]> {
    const values: string[] = [];
    // --directory includes otherwise invisible empty directories and prevents an
    // ignored blocker from being silently removed by reset --hard or a sequencer.
    for (const ignored of ignoredOnly === undefined ? [false, true] : [ignoredOnly]) {
      const result = await this.git(['ls-files', '--others', '--directory', '--exclude-standard', ...(ignored ? ['--ignored'] : []), '-z']);
      if (result.truncated) throw new GitError({ message: '未跟踪内容过多，无法完整验证文件安全性' });
      values.push(...result.stdout.split('\0').filter(Boolean));
    }
    return values;
  }
  private pathsCollide(a: string, b: string) {
    const normalize = (value: string) => { const p = value.replace(/\/+$/, ''); return process.platform === 'win32' ? p.toLowerCase() : p; };
    const left = normalize(a), right = normalize(b);
    return left === right || left.startsWith(right + '/') || right.startsWith(left + '/');
  }
  private async replayCommits(onto: string, originalHead: string): Promise<string[]> {
    const result = await this.git(['rev-list', '--topo-order', `${hash(onto)}..${hash(originalHead)}`, '--']);
    if (result.truncated) throw new GitError({ message: '待重放历史过大，无法完整验证变基文件安全性' });
    return result.stdout.trim().split(/\r?\n/).filter(Boolean);
  }
  private async changedTreePaths(commits: string[]): Promise<TreePath[]> {
    if (!commits.length) return [];
    // Raw -m diffs cover every parent and both sides of a rename. In particular,
    // an add-then-delete path is still checked even when neither endpoint tree has it.
    const result = await this.git(['diff-tree', '--stdin', '--root', '--no-commit-id', '-r', '-m', '--no-renames', '--raw', '-z'], { input: [...new Set(commits.map(hash))].join('\n') + '\n' });
    if (result.truncated) throw new GitError({ message: '历史变更路径过多，无法完整验证被忽略文件的安全性' });
    const records = result.stdout.split('\0'), paths: TreePath[] = [];
    for (let i = 0; i < records.length && records[i]; i += 2) {
      const metadata = records[i].split(' '), p = records[i + 1];
      if (!/^:\d{6}$/.test(metadata[0]) || !/^\d{6}$/.test(metadata[1] || '') || !p) throw new GitError({ message: '无法解析历史变更路径，未修改文件' });
      for (const mode of [metadata[0].slice(1), metadata[1]]) if (mode !== '000000') paths.push({ mode, path: filePath(p) });
    }
    return paths;
  }
  private async safeWritePath(p: string) {
    filePath(p);
    const segments = p.split('/');
    if (segments.some(segment => !segment || segment === '.' || (process.platform === 'win32' && (/[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))))) throw new GitError({ message: '文件路径无法安全恢复，未修改任何文件' });
    let current = this.root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      const stat = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
      if (!stat) return;
      if (stat.isSymbolicLink()) throw new GitError({ message: '恢复操作不支持符号链接或联接目录，请先在外部处理，未修改文件' });
      if (i < segments.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new GitError({ message: '恢复路径被目录或非普通文件占用，未修改任何文件' });
      const resolved = await fs.realpath(current), relative = path.relative(this.root, resolved);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new GitError({ message: '恢复路径指向仓库外部，未修改任何文件' });
    }
  }
  private async safeTreeWrites(commits: string[], policy: 'sequencer' | 'hard' | 'conservative' | 'saving' = 'conservative', changedCommits: string[] = []) {
    const ordinary = await this.untrackedPaths(false), ignored = await this.untrackedPaths(true);
    if ((policy !== 'hard' && policy !== 'saving' && ordinary.length) || (policy === 'conservative' && ignored.length)) throw new GitError({ message: policy === 'conservative' ? '请先移走或妥善保存所有未跟踪及忽略内容（包括目录），此操作不会删除这些内容' : '请先移走或妥善保存未跟踪内容，再继续操作；不会删除这些内容' });
    const entries = [...await this.indexPaths()];
    for (const id of new Set(commits.filter(id => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(id)))) entries.push(...await this.treePaths(id));
    entries.push(...await this.changedTreePaths(changedCommits));
    const paths = new Set<string>();
    for (const entry of entries) {
      if (!['100644', '100755'].includes(entry.mode)) throw new GitError({ message: '此操作暂不支持含子模块、符号链接或特殊索引条目的仓库，请使用外部 Git 工具' });
      paths.add(entry.path);
    }
    const protectedPaths = policy === 'hard' ? [...ordinary, ...ignored] : ignored, writes = [...paths];
    if (policy !== 'conservative' && protectedPaths.some(protectedPath => writes.some(p => this.pathsCollide(protectedPath, p)))) throw new GitError({ message: policy === 'hard' ? 'Hard Reset 路径与未跟踪或忽略内容存在覆盖冲突，请先移走或保存这些内容，未修改任何文件' : '操作路径（包括历史中间提交）与被忽略内容存在覆盖冲突，请先移走或保存这些内容，未修改任何文件' });
    for (const p of paths) await this.safeWritePath(p);
    if (policy === 'saving') {
      const files = await this.git(['ls-files', '--others', '--exclude-standard', '-z']);
      if (files.truncated) throw new GitError({ message: '未跟踪文件过多，无法完整验证保存安全性' });
      for (const p of files.stdout.split('\0').filter(Boolean)) await this.safeWritePath(filePath(p));
    }
  }
  private async sequencerCommand(kind: 'rebase' | 'revert', args: string[]) {
    try { await this.git(args); }
    catch (error) {
      if (!(error instanceof GitError) || error.details.cancelled) throw error;
      const stopped = await this.snapshot();
      if (stopped.operation?.kind === kind && stopped.entries.some(file => file.conflict)) return stopped;
      throw error;
    }
    return this.snapshot();
  }
  private async startRebase(p: Record<string, unknown>) {
    return this.manageRebaseSave(async () => {
    const byBranch = p.branch !== undefined, byCommit = p.targetCommit !== undefined;
    if (byBranch === byCommit) throw new GitError({ message: '请选择且仅选择一个变基目标：分支或指定提交' });
    const state = await this.snapshot();
    await this.expectedHead(p.expectedHead, state); await this.requireNoOperation(state);
    if (p.autoSaveChanges !== undefined && typeof p.autoSaveChanges !== 'boolean') throw new GitError({ message: '自动保存改动选项无效' });
    if (state.entries.length && !p.autoSaveChanges) throw new GitError({ message: '变基前请提交或妥善处理改动，或明确选择自动保存未提交改动后变基' });
    if (p.preserveMerges !== undefined && typeof p.preserveMerges !== 'boolean') throw new GitError({ message: '保留合并结构选项无效' });
    const branches = await this.branches(), source = p.sourceBranch === undefined ? state.branch : ref(p.sourceBranch, '源分支名称');
    if (!branches.some(branch => !branch.remote && branch.name === source)) throw new GitError({ message: '请选择已存在的本地源分支，不能直接变基远程分支' });
    const sourceRef = `refs/heads/${source}`, currentSource = source === state.branch;
    const sourceHead = (await this.git(['rev-parse', '--verify', `${sourceRef}^{commit}`])).stdout.trim();
    if (!currentSource || p.expectedSourceHead !== undefined) {
      if (typeof p.expectedSourceHead !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(p.expectedSourceHead) || p.expectedSourceHead.toLowerCase() !== sourceHead.toLowerCase()) throw new GitError({ message: '源分支已变化或确认版本无效，请刷新后重新确认源分支' });
    }
    let onto: string;
    if (byCommit) onto = await this.commitHash(p.targetCommit);
    else {
      const target = ref(p.branch, '目标分支名称'), selected = branches.find(branch => branch.name === target);
      if (!selected) throw new GitError({ message: '目标分支不存在，请刷新后重试' });
      if (!selected.remote && selected.name === source) throw new GitError({ message: '请选择不同于源分支的变基目标' });
      const fullRef = `refs/${selected.remote ? 'remotes' : 'heads'}/${target}`;
      onto = (await this.git(['rev-parse', '--verify', `${fullRef}^{commit}`])).stdout.trim();
    }
    const verifyReferences = async () => {
      await this.expectedHead(p.expectedHead, state);
      const latest = (await this.git(['rev-parse', '--verify', `${sourceRef}^{commit}`])).stdout.trim();
      if (latest.toLowerCase() !== sourceHead.toLowerCase()) throw new GitError({ message: '源分支已变化，请刷新后重新确认，未开始变基' });
      const activeRef = (await this.git(['symbolic-ref', '--quiet', 'HEAD'], { accepted: [0, 1] })).stdout.trim();
      if (activeRef !== `refs/heads/${state.branch}`) throw new GitError({ message: '当前工作区分支已变化，请刷新后重新确认，未开始变基' });
      const trees = await this.git(['worktree', 'list', '--porcelain', '-z']);
      if (trees.truncated) throw new GitError({ message: '工作区列表过大，无法确认源分支是否安全可用' });
      const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      for (const record of trees.stdout.split('\0\0')) if (record.split('\0').includes(`branch ${sourceRef}`)) {
        const location = record.split('\0').find(line => line.startsWith('worktree '))?.slice(9);
        if (!location || normalize(await fs.realpath(location).catch(() => location)) !== normalize(this.root)) throw new GitError({ message: `源分支 ${source} 已在另一个工作区检出：${location || '未知目录'}。请先结束该工作区的占用，未开始变基。` });
      }
    };
    await verifyReferences();
    // A non-current source is checked out by Git itself. Protect both that tree
    // transition and every source commit to be replayed, including deleted paths.
    const replay = await this.replayCommits(onto, sourceHead);
    await this.safeTreeWrites([state.head, sourceHead, onto], state.entries.length ? 'saving' : 'sequencer', replay);
    await verifyReferences();
    await this.saveHistoryBackup({ ...state, head: sourceHead, branch: source }, 'rebase');
    await verifyReferences();
    let saved: SavedRebaseRecord | undefined;
    try {
      if (state.entries.length) {
        saved = await this.beginRebaseSave(state, source, sourceHead);
        const clean = await this.snapshot();
        if (clean.entries.length) throw new GitError({ message: `保存后仍有未处理改动（${clean.entries.slice(0, 8).map(entry => entry.path).join('、')}），未开始变基，请检查保存备份及工作区` });
        await verifyReferences();
        await this.safeTreeWrites([state.head, sourceHead, onto], 'sequencer', replay);
        saved.rebaseStarted = true;
        await this.writeSavedRecord((await this.operationState()).gitDir, saved);
      }
      const result = await this.sequencerCommand('rebase', ['-c', 'rebase.updateRefs=false', '-c', 'rebase.autoStash=false', '-c', 'rebase.autoSquash=false', '-c', 'submodule.recurse=false', 'rebase', '--no-update-refs', '--no-autostash', '--no-autosquash', p.preserveMerges ? '--rebase-merges' : '--no-rebase-merges', '--', onto, ...(currentSource ? [] : [source])]);
      return saved ? this.completeRebaseSave(saved, result) : result;
    } catch (error) { if (saved) await this.noteRebaseSaveFailure(saved, error); throw error; }
    });
  }
  private async rebaseAction(action: unknown) {
    return this.manageRebaseSave(async () => {
    if (!['continue', 'skip', 'abort'].includes(action as string)) throw new GitError({ message: '变基操作无效' });
    const active = await this.operationState();
    if (active.operation?.kind !== 'rebase') throw new GitError({ message: '没有可继续或中止的变基操作，请刷新状态' });
    const state = await this.snapshot();
    if (action === 'continue' && state.entries.some(file => file.conflict)) return state;
    const completeRange = !!active.originalHead && !!active.operation.onto;
    await this.safeTreeWrites([state.head, active.originalHead || '', active.operation.onto || ''], completeRange ? 'sequencer' : 'conservative', completeRange ? await this.replayCommits(active.operation.onto!, active.originalHead!) : []);
    const saved = await this.readSavedRecord(active.gitDir);
    try {
      const result = await this.sequencerCommand('rebase', ['-c', 'rebase.updateRefs=false', '-c', 'rebase.autoStash=false', '-c', 'submodule.recurse=false', 'rebase', `--${action}`]);
      return saved && saved.status !== 'restored' ? this.completeRebaseSave(saved, result) : result;
    } catch (error) { if (saved && saved.status !== 'restored') await this.noteRebaseSaveFailure(saved, error); throw error; }
    });
  }
  private async startRevert(p: Record<string, unknown>) {
    const state = await this.snapshot(); await this.expectedHead(p.expectedHead, state); await this.requireNoOperation(state);
    if (state.entries.length) throw new GitError({ message: '撤销提交前请提交或妥善处理暂存区、工作区及未跟踪改动' });
    const id = await this.commitHash(p.hash); await this.requireAncestor(id, state.head);
    const parents = await this.parents(id);
    if (parents.length > 1 ? !Number.isInteger(p.mainline) || (p.mainline as number) < 1 || (p.mainline as number) > parents.length : p.mainline !== undefined) throw new GitError({ message: parents.length > 1 ? `撤销合并提交必须选择 1 至 ${parents.length} 的主线父提交` : '普通提交不应指定主线父提交' });
    await this.safeTreeWrites([state.head, id], 'sequencer', [id]); await this.expectedHead(p.expectedHead, state);
    await this.saveHistoryBackup(state, 'revert');
    return this.sequencerCommand('revert', ['-c', 'submodule.recurse=false', 'revert', '--no-edit', ...(parents.length > 1 ? ['--mainline', String(p.mainline)] : []), id]);
  }
  private async revertAction(action: unknown) {
    if (!['continue', 'abort'].includes(action as string)) throw new GitError({ message: '撤销提交操作无效' });
    const active = await this.operationState();
    if (active.operation?.kind !== 'revert') throw new GitError({ message: '没有可继续或中止的撤销提交操作，请刷新状态' });
    const state = await this.snapshot();
    if (action === 'continue' && state.entries.some(file => file.conflict)) return state;
    const commits = await Promise.all((active.commits || []).map(id => this.commitHash(id)));
    await this.safeTreeWrites([state.head, active.originalHead || '', ...commits], 'sequencer', commits);
    return this.sequencerCommand('revert', ['-c', 'submodule.recurse=false', 'revert', `--${action}`]);
  }
  private async resetHistory(p: Record<string, unknown>) {
    if (!['soft', 'mixed', 'hard'].includes(p.mode as string)) throw new GitError({ message: 'Reset 模式无效' });
    if (p.mode === 'hard' && p.discard !== true) throw new GitError({ message: 'Hard Reset 会丢弃已跟踪的未提交改动，必须明确确认后才能执行' });
    const state = await this.snapshot(); await this.expectedHead(p.expectedHead, state); await this.requireNoOperation(state, false);
    const id = await this.commitHash(p.hash); await this.requireAncestor(id, state.head);
    if (p.mode === 'hard') await this.safeTreeWrites([state.head, id], 'hard');
    await this.expectedHead(p.expectedHead, state); await this.saveHistoryBackup(state, `reset ${p.mode}`);
    await this.git(['-c', 'submodule.recurse=false', 'reset', `--${p.mode}`, '--no-recurse-submodules', id, '--']);
    return this.snapshot();
  }
  private async rollback(p: Record<string, unknown>) {
    const requested = names(p.paths);
    if (!['worktree', 'all'].includes(p.scope as string) || p.discard !== true) throw new GitError({ message: '文件恢复范围无效，或尚未明确确认丢弃所选改动' });
    const state = await this.snapshot(); await this.expectedHead(p.expectedHead, state); await this.requireNoOperation(state, false);
    const head = await this.treePaths(state.head), index = await this.indexPaths();
    const headMap = new Map(head.map(entry => [entry.path, entry])), indexMap = new Map(index.map(entry => [entry.path, entry]));
    const paths = new Set<string>();
    for (const selected of requested) {
      const entry = state.entries.find(entry => entry.path === selected || entry.originalPath === selected);
      if (!entry || entry.conflict || entry.worktree === '?' || entry.index === '?') throw new GitError({ message: '只能恢复当前状态中已跟踪的改动文件；不会删除未跟踪文件' });
      const renamed = !!entry.originalPath && (entry.index === 'R' || entry.worktree === 'R');
      if (!headMap.has(entry.path) && !(renamed && headMap.has(entry.originalPath!))) throw new GitError({ message: '所选文件在 HEAD 中不存在，请先取消暂存并在外部处理新文件，文件内容未删除' });
      if (p.scope === 'worktree') {
        if (!indexMap.has(entry.path)) throw new GitError({ message: '所选文件已从暂存区删除，请先取消暂存，或选择恢复 HEAD 的工作区及暂存区' });
        paths.add(entry.path);
      } else {
        paths.add(entry.path); if (renamed) paths.add(filePath(entry.originalPath!));
      }
    }
    const untracked = await this.untrackedPaths();
    for (const selected of paths) {
      if (untracked.some(value => this.pathsCollide(value, selected))) throw new GitError({ message: '恢复路径存在未跟踪或忽略内容，未覆盖或删除任何文件' });
      for (const entry of [headMap.get(selected), indexMap.get(selected)]) if (entry && !['100644', '100755'].includes(entry.mode)) throw new GitError({ message: '文件恢复仅支持普通已跟踪文件，不支持子模块或符号链接' });
      await this.safeWritePath(selected);
    }
    await this.expectedHead(p.expectedHead, state); await this.saveHistoryBackup(state, 'rollback selected files');
    await this.git(['-c', 'submodule.recurse=false', 'restore', ...(p.scope === 'all' ? ['--source=HEAD', '--staged', '--worktree'] : ['--worktree']), '--no-recurse-submodules', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: [...paths].join('\0') + '\0' });
    return this.snapshot();
  }
  private async mergeMetadata(): Promise<MergeWorkspace | undefined> {
    const dir = (await this.git(['rev-parse', '--absolute-git-dir'])).stdout.trim();
    try {
      const v = JSON.parse(await fs.readFile(path.join(dir, 'harborgit-merge.json'), 'utf8'));
      if (v && typeof v.sourceRoot === 'string' && path.isAbsolute(v.sourceRoot) && typeof v.sourceBranch === 'string' && typeof v.targetBranch === 'string') return { sourceRoot: v.sourceRoot, sourceBranch: ref(v.sourceBranch), targetBranch: ref(v.targetBranch) };
    } catch { /* Ordinary repository or invalid metadata. */ }
    return undefined;
  }
  private async mergeInto(target: string): Promise<MergeIntoResult> {
    ref(target); await this.branchExists(target, true);
    const original = await this.snapshot();
    if (original.unborn || original.detached || original.mergeInProgress || original.operation || (await this.operationState()).unsupported || original.entries.some(e => e.conflict) || original.mergeWorkspace) throw new GitError({ message: '请从正常的已提交分支发起合并，先完成或中止正在进行的 Git 操作' });
    if (original.branch === target) throw new GitError({ message: '目标分支必须与当前分支不同' });
    const trees = (await this.git(['worktree', 'list', '--porcelain', '-z'])).stdout.split('\0\0');
    for (const record of trees) if (record.split('\0').includes(`branch refs/heads/${target}`)) {
      const location = record.split('\0').find(l => l.startsWith('worktree '))?.slice(9) || '';
      throw new GitError({ message: `目标分支 ${target} 已在另一个工作区打开：${location}。请先在该工作区切换到其他分支，再从当前分支发起合并。` });
    }
    const common = (await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
    const base = this.options.mergeWorkspaceRoot ?? path.join(common, 'harborgit', 'merge-workspaces');
    await fs.mkdir(base, { recursive: true });
    const workspace = path.join(base, `merge-${randomUUID()}`);
    // A separate index and working tree keep every byte of source WIP intact.
    await this.git(['worktree', 'add', '--', workspace, target]);
    const metadata: MergeWorkspace = { sourceRoot: this.root, sourceBranch: original.branch, targetBranch: target };
    const dir = (await this.run(workspace, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
    await fs.writeFile(path.join(dir, 'harborgit-merge.json'), JSON.stringify(metadata));
    let failure: unknown;
    try {
      await this.run(workspace, ['merge', '--no-edit', '--', original.head]);
    } catch (e) { failure = e; }
    const recovery = new GitService(this.options);
    const result = await recovery.request('open', { path: workspace });
    if (!failure && !result.mergeInProgress && !result.entries.length) {
      try {
        await this.git(['worktree', 'remove', '--', workspace]);
        return { repository: await this.snapshot(), mergeRepository: null, status: 'merged', message: `已将 ${original.branch} 的已提交内容合并到 ${target}，当前未提交改动完整保留` };
      } catch (e) { failure = e; }
    }
    const reason = failure instanceof Error ? failure.message : '请检查合并结果';
    return { repository: await this.snapshot(), mergeRepository: result, status: 'attention', message: `合并工作区已保留：${reason}。请在新标签页解决冲突或中止；原 ${original.branch} 的未提交改动保持原样。` };
  }
  private async finishMergeWorkspace(): Promise<{ sourceRoot: string }> {
    const state = await this.snapshot(), meta = state.mergeWorkspace;
    if (!meta) throw new GitError({ message: '这不是 HarborGit 创建的合并工作区' });
    if (state.mergeInProgress || state.entries.length) throw new GitError({ message: '请先完成合并提交或中止合并，并处理此合并工作区中的改动' });
    // Validate shared Git identity, then let Git refuse any unsafe worktree removal.
    const here = (await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
    const there = (await this.run(meta.sourceRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
    if (path.resolve(here).toLowerCase() !== path.resolve(there).toLowerCase()) throw new GitError({ message: '合并工作区的原仓库身份不匹配，未清理任何内容' });
    await this.run(meta.sourceRoot, ['worktree', 'remove', '--', this.root]);
    return { sourceRoot: meta.sourceRoot };
  }
  private async open(p: string) {
    if (!path.isAbsolute(p)) throw new GitError({ message: '仓库目录必须为绝对路径' });
    const root = (await this.run(p, ['rev-parse', '--show-toplevel'])).stdout.trim();
    const previous = this.root;
    this.root = await fs.realpath(root);
    try { return await this.snapshot(); } catch (e) { this.root = previous; throw e; }
  }
  private async branchExists(name: string, localOnly = false) {
    const branches = await this.branches();
    if (!branches.some(b => b.name === name && (!localOnly || !b.remote))) throw new GitError({ message: '分支不存在，请刷新后重试' });
  }
  private async branches(): Promise<Branch[]> {
    const out = (await this.git(['for-each-ref', '--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(subject)%00%(objectname)', 'refs/heads/', 'refs/remotes/'])).stdout;
    return out.split('\n').filter(Boolean).map(line => {
      const [full, current, upstream, subject, hash] = line.split('\0');
      return { name: full.replace(/^refs\/(heads|remotes)\//, ''), current: current === '*', remote: full.startsWith('refs/remotes/'), upstream, subject, hash };
    }).filter(b => !b.name.endsWith('/HEAD'));
  }
  private async remotes(): Promise<Remote[]> {
    const list = (await this.git(['remote'])).stdout.trim().split('\n').filter(Boolean);
    const remotes: Remote[] = [];
    for (const name of list) {
      const fetch = (await this.git(['remote', 'get-url', '--', name])).stdout.trim();
      const push = (await this.git(['remote', 'get-url', '--push', '--', name])).stdout.trim();
      remotes.push({ name, fetch: scrub(fetch), push: scrub(push) });
    }
    return remotes;
  }
  private async commitHash(v: unknown) { return (await this.git(['rev-parse', '--verify', `${hash(v)}^{commit}`])).stdout.trim(); }
  private async parents(id: string) { return (await this.git(['rev-list', '--parents', '-n', '1', id])).stdout.trim().split(' ').slice(1); }
  private async history(skip = 0, limit = 100, scope: 'current' | 'all' = 'current'): Promise<Commit[]> {
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new GitError({ message: '历史分页参数无效' });
    if (!['current', 'all'].includes(scope)) throw new GitError({ message: '历史范围无效' });
    const hasHead = await this.hasHead();
    if (!hasHead && (scope === 'current' || !(await this.git(['for-each-ref', '--count=1', '--format=%(objectname)'])).stdout.trim())) return [];
    const revisions = scope === 'all' ? ['--branches', '--remotes', '--tags', ...(hasHead ? ['HEAD'] : [])] : ['HEAD'];
    const r = await this.git(['log', '-z', '--topo-order', '--decorate=full', `--skip=${skip}`, `--max-count=${limit}`, '--date=iso-strict', '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D', ...revisions, '--']);
    if (r.truncated) throw new GitError({ message: '历史内容过大，请减小每页提交数量' });
    const fields = r.stdout.split('\0'), commits: Commit[] = [];
    for (let i = 0; i + 8 < fields.length; i += 9) {
      const [hash, shortHash, parents, author, email, date, subject, body, refs] = fields.slice(i, i + 9);
      commits.push({ hash, shortHash, parents: parents ? parents.split(' ') : [], author, email, date, subject, body, refs });
    }
    return commits;
  }
  private async stagedTree() { return (await this.git(['write-tree'])).stdout.trim(); }
  private async stagedSnapshot(): Promise<StagedSnapshot> {
    const state = await this.snapshot();
    if (state.entries.some(e => e.conflict)) throw new GitError({ message: '请先解决冲突，再生成提交消息' });
    const tree = await this.stagedTree();
    const base = state.head || (await this.git(['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' })).stdout.trim();
    const fileResult = await this.git(['diff', '--name-status', '--no-ext-diff', '--no-textconv', '-z', '-M', base, tree, '--']);
    if (fileResult.truncated) throw new GitError({ message: '暂存文件列表超过读取上限，请拆分提交' });
    const fields = fileResult.stdout.split('\0'), files: CommitFile[] = [];
    for (let i = 0; i < fields.length && fields[i];) { const status = fields[i++], first = fields[i++]; if (/^[RC]/.test(status)) files.push({ status, oldPath: first, path: fields[i++] }); else files.push({ status, path: first }); }
    if (!files.length) throw new GitError({ message: '暂存区为空，请先暂存要提交的文件' });
    if (files.length > 1000) throw new GitError({ message: '一次最多为 1000 个暂存文件生成消息，请拆分提交' });
    const result = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--unified=3', base, tree, '--'], { limit: 80000 });
    return { tree, files, diff: result.stdout, truncated: result.truncated };
  }
  private async generateCommit(): Promise<AiSuggestion> {
    if (!this.options.generateMessage) throw new GitError({ message: '请先配置 AI 服务' });
    const snapshot = await this.stagedSnapshot(), id = randomUUID(), controller = new AbortController();
    const command = 'AI 生成暂存区提交消息', time = () => new Date().toISOString();
    this.aiTasks.set(id, controller); this.emit({ id, command, kind: 'start', text: '', time: time() });
    try {
      const message = await this.options.generateMessage(snapshot, controller.signal);
      if (controller.signal.aborted) throw new Error('AI 生成已取消');
      const stale = await this.stagedTree() !== snapshot.tree;
      this.emit({ id, command, kind: 'finish', text: 'AI 提交消息已生成，等待检查后应用', time: time(), exitCode: 0 });
      return { message, tree: snapshot.tree, fileCount: snapshot.files.length, truncated: snapshot.truncated, stale };
    } catch (e) {
      const message = controller.signal.aborted ? 'AI 生成已取消' : e instanceof Error ? e.message : String(e);
      this.emit({ id, command, kind: 'finish', text: message, time: time(), exitCode: -1 });
      throw new GitError({ message, cancelled: controller.signal.aborted });
    } finally { this.aiTasks.delete(id); }
  }
  private async commitFiles(v: unknown): Promise<CommitFile[]> {
    const id = await this.commitHash(v), parents = await this.parents(id);
    const args = parents.length ? ['diff', '--name-status', '-z', '-M', parents[0], id] : ['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '-M', id];
    const r = await this.git(args);
    if (r.truncated) throw new GitError({ message: '提交包含的文件过多，超过读取上限' });
    const parts = r.stdout.split('\0'), files: CommitFile[] = [];
    for (let i = 0; i < parts.length && parts[i];) {
      const status = parts[i++], first = parts[i++];
      if (/^[RC]/.test(status)) files.push({ status, oldPath: first, path: parts[i++] });
      else files.push({ status, path: first });
    }
    return files;
  }
  private async safeFile(p: string, write = false): Promise<string> {
    const target = path.resolve(this.root, filePath(p));
    // Never follow a repository symlink or junction when reading/writing the manual editor.
    const segments = p.split('/');
    let parent = this.root;
    for (const seg of segments.slice(0, -1)) {
      parent = path.join(parent, seg);
      const stat = await fs.lstat(parent);
      if (stat.isSymbolicLink()) throw new GitError({ message: '不能在符号链接或联接目录下编辑文件' });
    }
    const stat = await fs.lstat(target).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT' && write) return null; throw e; });
    if (stat?.isSymbolicLink()) throw new GitError({ message: '此编辑器不支持符号链接；请在外部解决后暂存' });
    if (stat && !stat.isFile()) throw new GitError({ message: '此操作仅支持普通文件' });
    return target;
  }
  private async readSmall(target: string): Promise<{ buffer: Buffer; truncated: boolean }> {
    const handle = await fs.open(target, 'r');
    try { const b = Buffer.alloc(MAX_TEXT + 1); const { bytesRead } = await handle.read(b, 0, b.length, 0); return { buffer: b.subarray(0, Math.min(bytesRead, MAX_TEXT)), truncated: bytesRead > MAX_TEXT }; } finally { await handle.close(); }
  }
  private async diff(p: string, area: string, commit?: string, oldPath?: string): Promise<Diff> {
    filePath(p); if (oldPath) filePath(oldPath);
    if (!['worktree', 'index', 'commit'].includes(area)) throw new GitError({ message: '差异范围无效' });
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];
    if (area === 'commit') {
      const id = await this.commitHash(commit), parents = await this.parents(id);
      if (parents.length) args.push(parents[0], id);
      else { args.splice(0, args.length, 'show', '--format=', '--root', '--no-ext-diff', '--no-textconv', '--no-color', id); }
    } else if (area === 'index') args.push('--cached');
    else {
      const status = parseStatus((await this.git(['status', '--porcelain=v2', '-z', '--untracked-files=all'])).stdout);
      if (status.entries.some(e => e.path === p && e.worktree === '?')) {
        const f = await this.safeFile(p), r = await this.readSmall(f);
        if (r.buffer.includes(0)) return { text: '二进制文件：不显示文本差异', binary: true, truncated: r.truncated };
        const value = r.buffer.toString('utf8'), lines = value.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        return { text: `diff --git a/${p} b/${p}\nnew file mode 100644\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => '+' + l).join('\n')}${value.endsWith('\n') ? '\n' : '\n\\ No newline at end of file\n'}`, binary: false, truncated: r.truncated };
      }
    }
    args.push('--', ...[oldPath, p].filter((v): v is string => !!v));
    const r = await this.git(args, { limit: MAX_TEXT });
    return { text: r.stdout, binary: /(?:Binary files .* differ|GIT binary patch)/.test(r.stdout), truncated: r.truncated };
  }
  private async conflict(p: string): Promise<Conflict> {
    filePath(p);
    const status = await this.snapshot();
    if (!status.entries.some(e => e.path === p && e.conflict)) throw new GitError({ message: '文件已不处于冲突状态，请刷新' });
    const contents: (string | null)[] = []; let binary = false, truncated = false;
    for (const stage of [1, 2, 3]) {
      const r = await this.git(['show', `:${stage}:${p}`], { accepted: [0, 128], limit: MAX_TEXT });
      contents.push(r.code === 0 ? r.stdout : null); binary ||= r.stdout.includes('\0'); truncated ||= r.truncated;
    }
    let working = '';
    try { const r = await this.readSmall(await this.safeFile(p)); working = r.buffer.toString('utf8'); binary ||= r.buffer.includes(0); truncated ||= r.truncated; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return { path: p, base: contents[0], ours: contents[1], theirs: contents[2], worktree: working, binary, truncated };
  }
  private async resolve(p: string, choice: string, content?: string) {
    filePath(p);
    const status = await this.snapshot();
    if (!status.entries.some(e => e.path === p && e.conflict)) throw new GitError({ message: '文件已不处于冲突状态，请刷新' });
    if (choice === 'manual') {
      const conflict = await this.conflict(p);
      if (conflict.binary || conflict.truncated) throw new GitError({ message: '二进制或过大的文件请在外部工具解决后暂存' });
      if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > MAX_TEXT) throw new GitError({ message: '解决内容无效或超过 2 MiB' });
      if (/^(<<<<<<< |=======$|>>>>>>> )/m.test(content)) throw new GitError({ message: '请先清除所有冲突标记' });
      await fs.writeFile(await this.safeFile(p, true), content, 'utf8');
      await this.git(['add', '--', p]);
    } else if (choice === 'ours' || choice === 'theirs') {
      const stage = choice === 'ours' ? 2 : 3;
      const exists = (await this.git(['ls-files', '--unmerged', '-z', '--', p])).stdout.split('\0').some(l => l.split('\t')[0].endsWith(` ${stage}`));
      if (exists) { await this.git(['checkout', `--${choice}`, '--', p]); await this.git(['add', '--', p]); }
      else await this.git(['rm', '--', p]);
    } else throw new GitError({ message: '解决方式无效' });
    return this.snapshot();
  }
  private async dispatch(operation: keyof Requests, payload: unknown): Promise<unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GitError({ message: '请求参数无效' });
    const p = payload as Record<string, unknown>;
    if (this.root && operation !== 'open' && operation !== 'clone') {
      const active = await this.operationState();
      const permitted = new Set<keyof Requests>(['refresh', 'diff', 'history', 'commitFiles', 'branches', 'remotes', 'stagedSnapshot', 'stagedTree', 'generateCommit', 'stage', 'unstage', 'resolve', 'conflict', 'identity', 'rebaseAction', 'revertAction']);
      if ((active.operation || active.unsupported) && !permitted.has(operation)) throw new GitError({ message: `当前正在进行${active.operation?.kind === 'rebase' ? '变基，请使用变基的继续、跳过或中止' : active.operation?.kind === 'revert' ? '撤销提交，请使用撤销提交的继续或中止' : `${active.unsupported}，请先在外部 Git 工具中完成或中止`}操作` });
      const saved = await this.savedRebaseRecord(active);
      const recoveryPermitted = new Set<keyof Requests>([...permitted, 'rebaseSavedAction']);
      if (saved && saved.status !== 'restored' && !recoveryPermitted.has(operation)) throw new GitError({ message: '请先恢复保存的变基改动或确认手工处理完成；专用 WIP 备份保留' });
    }
    switch (operation) {
      case 'open': return this.open(text(p.path, '仓库路径'));
      case 'clone': {
        const url = remoteUrl(p.url), destination = text(p.destination, '目标目录');
        if (!path.isAbsolute(destination)) throw new GitError({ message: '目标目录必须为绝对路径' });
        const exists = await fs.stat(destination).catch(() => null);
        if (exists && (!exists.isDirectory() || (await fs.readdir(destination)).length)) throw new GitError({ message: '克隆目标必须不存在或为空目录' });
        await this.run(path.dirname(destination), ['clone', '--progress', '--', url, destination], { timeout: this.options.timeoutMs ?? 600000, authenticate: true });
        return this.open(destination);
      }
      case 'refresh': return this.snapshot();
      case 'diff': return this.diff(text(p.path, '文件路径'), text(p.area, '范围'), p.commit as string | undefined, p.oldPath as string | undefined);
      case 'stage': {
        const paths = names(p.paths), status = await this.snapshot();
        // Index renames have two path endpoints; update both when staging a worktree rename.
        const all = new Set(paths);
        for (const e of status.entries) if (paths.includes(e.path) && e.originalPath && e.worktree === 'R') all.add(e.originalPath);
        await this.git(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: [...all].join('\0') + '\0' }); return this.snapshot();
      }
      case 'unstage': {
        const paths = names(p.paths), status = await this.snapshot(); const all = new Set(paths);
        for (const e of status.entries) if (paths.includes(e.path) && e.originalPath) all.add(e.originalPath);
        const input = [...all].join('\0') + '\0';
        if (await this.hasHead()) await this.git(['reset', '--quiet', 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'], { input });
        else await this.git(['rm', '--cached', '-r', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { input });
        return this.snapshot();
      }
      case 'commit': {
        const message = text(p.message, '提交信息', 65536);
        if (!message.trim()) throw new GitError({ message: '请输入提交信息' });
        const status = await this.snapshot();
        if (status.entries.some(e => e.conflict)) throw new GitError({ message: '请先解决并暂存所有冲突' });
        if (!status.mergeInProgress && !status.entries.some(e => e.index !== ' ')) throw new GitError({ message: '暂存区为空' });
        await this.git(['commit', '--file=-'], { input: message }); return this.snapshot();
      }
      case 'history': return this.history(p.skip as number | undefined, p.limit as number | undefined, p.scope as 'current' | 'all' | undefined);
      case 'stagedSnapshot': return this.stagedSnapshot();
      case 'stagedTree': return this.stagedTree();
      case 'generateCommit': return this.generateCommit();
      case 'commitFiles': return this.commitFiles(p.hash);
      case 'branches': return this.branches();
      case 'createBranch': {
        const name = ref(p.name); await this.git(['check-ref-format', '--branch', name]);
        await this.git(['switch', '-c', name, ...(p.startPoint ? [ref(p.startPoint)] : [])]); return this.snapshot();
      }
      case 'checkout': { const name = ref(p.name); await this.branchExists(name); const b = (await this.branches()).find(b => b.name === name)!; if (b.remote) await this.git(['switch', '--track', name]); else await this.git(['switch', name]); return this.snapshot(); }
      case 'deleteBranch': { const name = ref(p.name); await this.branchExists(name, true); await this.git(['branch', '-d', '--', name]); return this.snapshot(); }
      case 'remotes': return this.remotes();
      case 'saveRemote': {
        const name = ref(p.name, '远程名称'), url = remoteUrl(p.url), pushUrl = p.pushUrl ? remoteUrl(p.pushUrl) : '';
        if (typeof p.create !== 'boolean') throw new GitError({ message: '远程仓库保存方式无效' });
        const exists = (await this.remotes()).some(r => r.name === name);
        if (p.create && exists) throw new GitError({ message: '远程名称已存在，请编辑已有远程仓库或使用其他名称' });
        if (!p.create && !exists) throw new GitError({ message: '远程仓库不存在，请刷新后重试' });
        await this.git(['check-ref-format', `refs/remotes/${name}/HEAD`]);
        if (!p.create) {
          // Do not silently collapse advanced multi-URL configurations in this form.
          for (const key of ['url', 'pushurl']) {
            const values = (await this.git(['config', '--get-all', `remote.${name}.${key}`], { accepted: [0, 1] })).stdout.trim().split('\n').filter(Boolean);
            if (values.length > 1) throw new GitError({ message: '该远程配置了多个地址，当前表单仅支持单地址配置，未修改任何地址' });
          }
        }
        // Saving is local only: never fetch or authenticate as a side effect.
        await this.git(p.create ? ['remote', 'add', '--', name, url] : ['remote', 'set-url', '--', name, url]);
        if (pushUrl) await this.git(['remote', 'set-url', '--push', '--', name, pushUrl]);
        else await this.git(['config', '--local', '--unset-all', `remote.${name}.pushurl`], { accepted: [0, 5] });
        return this.snapshot();
      }
      case 'removeRemote': {
        const name = ref(p.name, '远程名称');
        if (!(await this.remotes()).some(r => r.name === name)) throw new GitError({ message: '远程仓库不存在，请刷新后重试' });
        await this.git(['remote', 'remove', '--', name]); return this.snapshot();
      }
      case 'remote': {
        const action = text(p.action, '远程操作'), remote = ref(p.remote, '远程名称');
        if (!(await this.remotes()).some(r => r.name === remote)) throw new GitError({ message: '远程仓库不存在' });
        const branch = p.branch ? ref(p.branch) : '';
        if (action === 'fetch') await this.git(['fetch', '--progress', '--prune', '--', remote], { timeout: this.options.timeoutMs ?? 600000, authenticate: true });
        else if (action === 'pull') await this.git(['pull', '--ff-only', '--no-rebase', '--progress', '--', remote, ...(branch ? [branch] : [])], { timeout: this.options.timeoutMs ?? 600000, authenticate: true });
        else if (action === 'push') {
          const status = await this.snapshot();
          if (status.detached || status.unborn) throw new GitError({ message: 'Push 需要已提交的本地分支' });
          // Explicit HEAD avoids push.default matching multiple branches. Never force push.
          await this.git(['push', '--progress', '--set-upstream', '--', remote, `HEAD:refs/heads/${branch || status.branch}`], { timeout: this.options.timeoutMs ?? 600000, authenticate: true });
        } else throw new GitError({ message: '未知远程操作' });
        return this.snapshot();
      }
      case 'merge': { const name = ref(p.branch); await this.branchExists(name); await this.git(['merge', '--no-edit', '--', name]); return this.snapshot(); }
      case 'mergeInto': return this.mergeInto(text(p.target, '目标分支'));
      case 'finishMergeWorkspace': return this.finishMergeWorkspace();
      case 'conflict': return this.conflict(text(p.path, '文件路径'));
      case 'resolve': return this.resolve(text(p.path, '文件路径'), text(p.choice, '解决方式'), p.content as string | undefined);
      case 'abortMerge': { if (!(await this.snapshot()).mergeInProgress) throw new GitError({ message: '没有进行中的合并' }); await this.git(['merge', '--abort']); return this.snapshot(); }
      case 'rebase': return this.startRebase(p);
      case 'rebaseAction': return this.rebaseAction(p.action);
      case 'rebaseSavedAction': return this.rebaseSavedAction(p.action);
      case 'revert': return this.startRevert(p);
      case 'revertAction': return this.revertAction(p.action);
      case 'reset': return this.resetHistory(p);
      case 'rollback': return this.rollback(p);
      case 'identity': { const name = text(p.name, '用户名', 256), email = text(p.email, '邮箱', 256); await this.git(['config', '--local', 'user.name', name]); await this.git(['config', '--local', 'user.email', email]); return this.snapshot(); }
      default: throw new GitError({ message: '不支持的操作' });
    }
  }
}
