import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { Activity, Branch, Commit, CommitFile, Conflict, Diff, Failure, FileChange, Remote, Repository, Requests, Responses } from '../shared/types';

export class GitError extends Error {
  readonly details: Failure;
  constructor(details: Failure) { super(details.message); this.name = 'GitError'; this.details = details; }
}
interface Options { onActivity?: (event: Activity) => void; gitPath?: string; timeoutMs?: number; outputLimit?: number; }
interface CommandResult { stdout: string; stderr: string; code: number; truncated: boolean; }
interface RunOptions { accepted?: number[]; input?: string; limit?: number; timeout?: number; }
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
function ref(v: unknown): string {
  const s = text(v, '分支名称', 1024);
  if (s.startsWith('-') || s.startsWith('/') || s.endsWith('/') || s.includes('..') || s.includes('@{') || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(s)) throw new GitError({ message: '分支名称无效' });
  return s;
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
  constructor(private options: Options = {}) {}
  cancel(id: string): boolean { const job = this.running.get(id); if (!job) return false; job.stop('操作已取消，请刷新状态确认已完成的部分'); return true; }
  cancelAll() { for (const id of this.running.keys()) this.cancel(id); }
  request<K extends keyof Requests>(operation: K, payload: Requests[K]): Promise<Responses[K]> {
    const task = this.queue.then(() => this.dispatch(operation, payload));
    this.queue = task.catch(() => undefined);
    return task as Promise<Responses[K]>;
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
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_MERGE_AUTOEDIT: 'no', GIT_PAGER: 'cat', LC_ALL: 'C.UTF-8' },
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
          reject(new GitError({ message: stopped || (spawnError ? `无法启动 Git。请安装 Git for Windows 并将 git.exe 加入 PATH。${spawnError}` : stderr.trim().slice(-4000) || scrub(stdout).trim().slice(-4000) || `Git 命令失败 (${code})`), command, code: code ?? -1, stderr, stdout: scrub(stdout), cancelled: !!stopped }));
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
    return { root: this.root, ...status, mergeInProgress, userName, userEmail };
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
  private async history(skip = 0, limit = 100): Promise<Commit[]> {
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new GitError({ message: '历史分页参数无效' });
    if (!await this.hasHead()) return [];
    const r = await this.git(['log', '-z', `--skip=${skip}`, `--max-count=${limit}`, '--date=iso-strict', '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D', 'HEAD']);
    if (r.truncated) throw new GitError({ message: '历史内容过大，请减小每页提交数量' });
    const fields = r.stdout.split('\0'), commits: Commit[] = [];
    for (let i = 0; i + 8 < fields.length; i += 9) {
      const [hash, shortHash, parents, author, email, date, subject, body, refs] = fields.slice(i, i + 9);
      commits.push({ hash, shortHash, parents: parents ? parents.split(' ') : [], author, email, date, subject, body, refs });
    }
    return commits;
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
    switch (operation) {
      case 'open': return this.open(text(p.path, '仓库路径'));
      case 'clone': {
        const url = text(p.url, '克隆地址'), destination = text(p.destination, '目标目录');
        if (url.startsWith('-') || /^(?:ext|fd):/i.test(url)) throw new GitError({ message: '克隆地址或协议无效' });
        if (!path.isAbsolute(destination)) throw new GitError({ message: '目标目录必须为绝对路径' });
        const exists = await fs.stat(destination).catch(() => null);
        if (exists && (!exists.isDirectory() || (await fs.readdir(destination)).length)) throw new GitError({ message: '克隆目标必须不存在或为空目录' });
        await this.run(path.dirname(destination), ['clone', '--progress', '--', url, destination], { timeout: this.options.timeoutMs ?? 600000 });
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
      case 'history': return this.history(p.skip as number | undefined, p.limit as number | undefined);
      case 'commitFiles': return this.commitFiles(p.hash);
      case 'branches': return this.branches();
      case 'createBranch': {
        const name = ref(p.name); await this.git(['check-ref-format', '--branch', name]);
        await this.git(['switch', '-c', name, ...(p.startPoint ? [ref(p.startPoint)] : [])]); return this.snapshot();
      }
      case 'checkout': { const name = ref(p.name); await this.branchExists(name); const b = (await this.branches()).find(b => b.name === name)!; if (b.remote) await this.git(['switch', '--track', name]); else await this.git(['switch', name]); return this.snapshot(); }
      case 'deleteBranch': { const name = ref(p.name); await this.branchExists(name, true); await this.git(['branch', '-d', '--', name]); return this.snapshot(); }
      case 'remotes': return this.remotes();
      case 'remote': {
        const action = text(p.action, '远程操作'), remote = ref(p.remote);
        if (!(await this.remotes()).some(r => r.name === remote)) throw new GitError({ message: '远程仓库不存在' });
        const branch = p.branch ? ref(p.branch) : '';
        if (action === 'fetch') await this.git(['fetch', '--progress', '--prune', '--', remote], { timeout: this.options.timeoutMs ?? 600000 });
        else if (action === 'pull') await this.git(['pull', '--ff-only', '--no-rebase', '--progress', '--', remote, ...(branch ? [branch] : [])], { timeout: this.options.timeoutMs ?? 600000 });
        else if (action === 'push') {
          const status = await this.snapshot();
          if (status.detached || status.unborn) throw new GitError({ message: 'Push 需要已提交的本地分支' });
          // Explicit HEAD avoids push.default matching multiple branches. Never force push.
          await this.git(['push', '--progress', '--set-upstream', '--', remote, `HEAD:refs/heads/${branch || status.branch}`], { timeout: this.options.timeoutMs ?? 600000 });
        } else throw new GitError({ message: '未知远程操作' });
        return this.snapshot();
      }
      case 'merge': { const name = ref(p.branch); await this.branchExists(name); const status = await this.snapshot(); if (status.entries.length) throw new GitError({ message: '合并前请提交或处理当前改动' }); await this.git(['merge', '--no-edit', '--', name]); return this.snapshot(); }
      case 'conflict': return this.conflict(text(p.path, '文件路径'));
      case 'resolve': return this.resolve(text(p.path, '文件路径'), text(p.choice, '解决方式'), p.content as string | undefined);
      case 'abortMerge': { if (!(await this.snapshot()).mergeInProgress) throw new GitError({ message: '没有进行中的合并' }); await this.git(['merge', '--abort']); return this.snapshot(); }
      case 'identity': { const name = text(p.name, '用户名', 256), email = text(p.email, '邮箱', 256); await this.git(['config', '--local', 'user.name', name]); await this.git(['config', '--local', 'user.email', email]); return this.snapshot(); }
      default: throw new GitError({ message: '不支持的操作' });
    }
  }
}
