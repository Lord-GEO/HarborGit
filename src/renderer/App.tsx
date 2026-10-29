import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Activity, Area, Branch, Commit, CommitFile, Conflict, Diff, Failure, Remote, Repository, Requests, Responses } from '../shared/types';

type View = 'changes' | 'history' | 'branches';
type Selection = { path: string; area: Area; commit?: string; oldPath?: string };
type Modal = 'open' | 'clone' | 'createBranch' | 'remote' | 'identity' | 'deleteBranch' | 'abortMerge' | null;
const emptyDiff: Diff = { text: '', binary: false, truncated: false };
const statusLabels: Record<string, string> = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪', T: '类型变化' };
const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;
const isStaged = (code: string) => code !== ' ' && code !== '.' && code !== '?' && code !== '!';
const isChanged = (code: string) => code !== ' ' && code !== '.' && code !== '!';
const dateText = (date: string) => { const d = new Date(date); return Number.isNaN(d.valueOf()) ? date : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10m12-10c0 7-12 3-12 10" /></>,
    changes: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14h8m-8 4h5" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3z" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
    refresh: <><path d="M20 8a9 9 0 1 0 1 7M20 3v6h-6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    merge: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><path d="M6 7c0 4 6 3 6 10m6-10c0 4-6 3-6 10" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 2 4 3-2 1-3 4-1 1-4-3-2V5l-4-1-2 2z" /></>,
    terminal: <><path d="m5 7 5 5-5 5m8 0h6" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.changes}</svg>;
}

function DiffViewer({ diff, loading, title, subtitle, actions }: { diff: Diff; loading: boolean; title: string; subtitle?: string; actions?: ReactNode }) {
  let oldLine = 0; let newLine = 0; let inHunk = false;
  const lines = diff.text.split('\n', 10001);
  const uiTruncated = lines.length > 10000;
  return <section className="diff-panel" aria-label="文件差异">
    <div className="panel-top"><div className="diff-heading"><Icon name="changes" /><div><strong title={title}>{title || '选择一个文件查看差异'}</strong><small>{subtitle || '统一差异视图 · Unified diff'}</small></div></div><div className="inline-actions">{actions}</div></div>
    {loading ? <div className="center-message"><span className="spinner" />读取差异…</div> : !title ? <div className="center-message"><div className="empty-icon"><Icon name="changes" size={34} /></div><h3>每一处改动，都清晰可见</h3><p>从左侧选择一个文件，查看工作区或暂存区差异。</p></div> : diff.binary ? <div className="center-message"><Icon name="changes" size={32} /><h3>二进制文件</h3><p>此文件无法以文本方式展示差异，仍可暂存与提交。</p></div> : !diff.text ? <div className="center-message"><Icon name="check" size={32} /><h3>没有文本差异</h3><p>可能是空文件、文件模式变化或内容相同。</p></div> : <div className="diff-scroll" tabIndex={0} aria-label="差异内容">
      {(diff.truncated || uiTruncated) && <div className="inline-notice">{uiTruncated ? '差异行数较多，仅展示前 10,000 行。' : '文件较大，以下内容已截断。'}</div>}
      <table className="diff-table"><tbody>{lines.slice(0, 10000).map((line, i) => {
        let cls = 'context'; let left: number | string = ''; let right: number | string = '';
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); cls = 'hunk'; inHunk = true; }
        else if (line.startsWith('diff --git ')) { cls = 'metadata'; inHunk = false; }
        else if (!inHunk || line.startsWith('\\')) cls = 'metadata';
        else if (line.startsWith('+')) { cls = 'added'; right = newLine++; }
        else if (line.startsWith('-')) { cls = 'removed'; left = oldLine++; }
        else if (line.startsWith(' ')) { left = oldLine++; right = newLine++; }
        return <tr className={cls} key={i}><td className="line-number">{left}</td><td className="line-number">{right}</td><td className="line-code"><pre>{line || ' '}</pre></td></tr>;
      })}</tbody></table>
    </div>}
  </section>;
}

export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [view, setView] = useState<View>('changes');
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [error, setError] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<Diff>(emptyDiff);
  const [diffLoading, setDiffLoading] = useState(false);
  const diffEpoch = useRef(0);
  const [message, setMessage] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const historyEpoch = useRef(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [running, setRunning] = useState<Record<string, Activity>>({});
  const [showLog, setShowLog] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchStart, setBranchStart] = useState('');
  const [remoteAction, setRemoteAction] = useState<'fetch' | 'pull' | 'push'>('fetch');
  const [remoteName, setRemoteName] = useState('origin');
  const [remoteBranch, setRemoteBranch] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [deleteBranch, setDeleteBranch] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolvedText, setResolvedText] = useState('');
  const [version, setVersion] = useState('');
  const repoKey = useRef('');
  const api = window.harbor;

  const call = useCallback(async <K extends keyof Requests>(operation: K, payload: Requests[K]): Promise<Responses[K] | undefined> => {
    try { const result = await window.harbor.request(operation, payload); if (!result.ok) { setError(result.error); return undefined; } return result.data; }
    catch (e) { setError({ message: e instanceof Error ? e.message : String(e) }); return undefined; }
  }, []);

  useEffect(() => {
    if (!api) return;
    void api.recent().then(setRecent).catch(() => {});
    void api.version().then(setVersion).catch(() => {});
    return api.onActivity(event => {
      setActivities(list => [...list, event].slice(-250));
      setRunning(current => { const next = { ...current }; if (event.kind === 'finish') delete next[event.id]; else next[event.id] = event; return next; });
    });
  }, [api]);

  const acceptRepo = useCallback((next: Repository) => {
    const switched = repoKey.current !== next.root;
    repoKey.current = next.root;
    setRepo(next);
    if (switched) { ++historyEpoch.current; ++diffEpoch.current; setSelection(null); setSelectedCommit(null); setCommitFiles([]); setCommits([]); setBranches([]); setDiff(emptyDiff); setMessage(''); setFileFilter(''); setConflict(null); setView('changes'); }
    else setSelection(current => current?.area === 'commit' || (current && next.entries.some(e => e.path === current.path && (current.area === 'index' ? isStaged(e.index) && !e.conflict : isChanged(e.worktree) || e.conflict))) ? current : null);
    void window.harbor.recent().then(setRecent).catch(() => {});
  }, []);

  const loadSupplementary = useCallback(async () => {
    const root = repoKey.current;
    const [nextBranches, nextRemotes] = await Promise.all([call('branches', {}), call('remotes', {})]);
    if (repoKey.current !== root) return;
    if (nextBranches) setBranches(nextBranches);
    if (nextRemotes) { setRemotes(nextRemotes); if (nextRemotes.length) setRemoteName(current => nextRemotes.some(r => r.name === current) ? current : nextRemotes[0].name); }
  }, [call]);

  const loadHistory = useCallback(async (more = false) => {
    const root = repoKey.current;
    const next = await call('history', { skip: more ? commits.length : 0, limit: 100 });
    if (next && root === repoKey.current) setCommits(current => more ? [...current, ...next.filter(c => !current.some(old => old.hash === c.hash))] : next);
  }, [call, commits.length]);

  const run = useCallback(async (label: string, action: () => Promise<Repository | undefined>, success?: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null); setNotice('');
    try {
      const next = await action();
      if (next) { acceptRepo(next); if (success) setNotice(success); await loadSupplementary(); if (view === 'history') await loadHistory(); }
      else if (repoKey.current) { const fresh = await call('refresh', {}); if (fresh) acceptRepo(fresh); }
    } finally { busyRef.current = false; setBusy(''); }
  }, [acceptRepo, call, loadHistory, loadSupplementary, view]);

  useEffect(() => {
    const epoch = ++diffEpoch.current;
    if (!selection) { setDiff(emptyDiff); setDiffLoading(false); return; }
    setDiffLoading(true); setDiff(emptyDiff);
    void call('diff', selection).then(next => { if (epoch === diffEpoch.current) { if (next) setDiff(next); setDiffLoading(false); } });
  }, [selection, repo, call]);

  useEffect(() => { if (repo && view === 'history') void loadHistory(); }, [view, repo?.root]);
  useEffect(() => { if (repo && view === 'branches') void loadSupplementary(); }, [view, repo?.root, loadSupplementary]);
  useEffect(() => {
    const onFocus = () => { if (repoKey.current && !busyRef.current && !modal && !conflict) void run('刷新仓库…', () => call('refresh', {})); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [call, run, modal, conflict]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || !['KeyO', 'KeyR'].includes(event.code)) return;
      event.preventDefault();
      if (busyRef.current || modal || conflict) return;
      if (event.code === 'KeyO') { setPath(''); setError(null); setModal('open'); }
      else if (repoKey.current) void run('刷新仓库…', () => call('refresh', {}));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [call, run, modal, conflict]);

  const pick = async () => { try { const selected = await api.pickDirectory(); if (selected) setPath(selected); } catch (e) { setError({ message: String(e) }); } };
  const openRepo = (repositoryPath: string) => run('打开仓库…', () => call('open', { path: repositoryPath }), '仓库已打开');
  const showOpen = () => { setPath(''); setModal('open'); setError(null); };
  const showClone = () => { setPath(''); setUrl(''); setModal('clone'); setError(null); };
  const refresh = () => run('刷新仓库…', () => call('refresh', {}));
  const stage = (paths: string[]) => run('暂存文件…', () => call('stage', { paths }), '已暂存选中文件');
  const unstage = (paths: string[]) => run('取消暂存…', () => call('unstage', { paths }), '已取消暂存，工作区内容已保留');
  const chooseCommit = async (commit: Commit) => {
    const epoch = ++historyEpoch.current; setSelectedCommit(commit); setCommitFiles([]); setSelection(null);
    const files = await call('commitFiles', { hash: commit.hash });
    if (files && epoch === historyEpoch.current) { setCommitFiles(files); if (files[0]) setSelection({ path: files[0].path, oldPath: files[0].oldPath, area: 'commit', commit: commit.hash }); }
  };
  const showRemote = (action: 'fetch' | 'pull' | 'push') => { setRemoteAction(action); setRemoteBranch(repo?.branch === '(detached)' ? '' : repo?.branch || ''); setModal('remote'); setError(null); };
  const showIdentity = () => { setUserName(repo?.userName || ''); setUserEmail(repo?.userEmail || ''); setModal('identity'); };
  const showConflict = async (filePath: string) => { setError(null); const next = await call('conflict', { path: filePath }); if (next) { setConflict(next); setResolvedText(next.worktree); } };
  const resolveConflict = async (choice: 'ours' | 'theirs' | 'manual') => {
    if (!conflict) return;
    await run('保存冲突解决结果…', async () => { const next = await call('resolve', { path: conflict.path, choice, ...(choice === 'manual' ? { content: resolvedText } : {}) }); if (next) setConflict(null); return next; }, '冲突已解决并暂存，请检查后提交');
  };
  const submitModal = async (event: FormEvent) => {
    event.preventDefault();
    if (modal === 'open') await run('打开仓库…', async () => { const next = await call('open', { path }); if (next) setModal(null); return next; }, '仓库已打开');
    else if (modal === 'clone') await run('克隆仓库…', async () => { const next = await call('clone', { url, destination: path }); if (next) setModal(null); return next; }, '克隆完成');
    else if (modal === 'createBranch') await run('创建并切换分支…', async () => { const next = await call('createBranch', { name: branchName, ...(branchStart ? { startPoint: branchStart } : {}) }); if (next) setModal(null); return next; }, '分支已创建并切换');
    else if (modal === 'identity') await run('保存提交身份…', async () => { const next = await call('identity', { name: userName, email: userEmail }); if (next) setModal(null); return next; }, '已保存到当前仓库');
    else if (modal === 'remote') await run(`${remoteAction === 'fetch' ? '获取远程更新' : remoteAction === 'pull' ? '拉取更新' : '推送提交'}…`, async () => { const next = await call('remote', { action: remoteAction, remote: remoteName, ...(remoteBranch ? { branch: remoteBranch } : {}) }); if (next) setModal(null); return next; }, '远程操作完成');
    else if (modal === 'deleteBranch') await run('删除分支…', async () => { const next = await call('deleteBranch', { name: deleteBranch }); if (next) setModal(null); return next; }, '分支已删除');
    else if (modal === 'abortMerge') await run('中止合并…', async () => { const next = await call('abortMerge', {}); if (next) setModal(null); return next; }, '合并已中止');
  };

  if (!api) return <main className="desktop-required"><div className="brand-mark">H</div><h1>HarborGit</h1><p>请通过 Electron 桌面应用启动，以连接本机 Git。</p><code>npm start</code></main>;

  const staged = repo?.entries.filter(e => isStaged(e.index) && !e.conflict) || [];
  const unstaged = repo?.entries.filter(e => isChanged(e.worktree) || e.conflict) || [];
  const conflicts = repo?.entries.filter(e => e.conflict) || [];
  const activeActivity = Object.values(running).at(-1);
  const fileButton = (entry: Repository['entries'][number], area: 'index' | 'worktree') => {
    const code = entry.conflict ? 'U' : area === 'index' ? entry.index : entry.worktree;
    const selected = selection?.path === entry.path && selection.area === area;
    return <div className={`file-row ${selected ? 'selected' : ''}`} key={`${area}:${entry.path}`}>
      <button className="file-select" onClick={() => setSelection({ path: entry.path, oldPath: entry.originalPath, area })} title={entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path} aria-label={`${area === 'index' ? '暂存区' : '工作区'} ${entry.path}`}><span className={`file-status status-${code}`}>{code}</span><span className="file-name">{basename(entry.path)}<small>{entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/')) : statusLabels[code] || code}</small></span></button>
      {entry.conflict ? <button className="icon-button" title="解决冲突" aria-label={`解决冲突 ${entry.path}`} disabled={!!busy} onClick={() => void showConflict(entry.path)}><Icon name="merge" size={15} /></button> : <button className="icon-button" title={area === 'index' ? '取消暂存' : '暂存文件'} aria-label={`${area === 'index' ? '取消暂存' : '暂存'} ${entry.path}`} disabled={!!busy} onClick={() => void (area === 'index' ? unstage([entry.path]) : stage([entry.path]))}><Icon name={area === 'index' ? 'minus' : 'plus'} size={16} /></button>}
    </div>;
  };

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark">H</div><strong>Harbor<span>Git</span></strong><span className="brand-caption">把每次改动，稳稳靠岸。</span></div><div className="header-actions"><button className="quiet-button" onClick={showOpen} disabled={!!busy}><Icon name="folder" size={16} />打开仓库</button><button className="quiet-button" onClick={showClone} disabled={!!busy}><Icon name="download" size={16} />克隆</button></div></header>
    <div className="main-shell">
      <aside className="sidebar"><div className="sidebar-top"><span className="eyebrow">WORKSPACE</span>{repo ? <><h2 title={repo.root}>{basename(repo.root)}</h2><p className="repo-location" title={repo.root}>{repo.root}</p><div className="current-branch"><Icon name="branch" size={16} /><span>{repo.detached ? '分离 HEAD' : repo.branch}</span>{repo.unborn && <span className="tag">空仓库</span>}</div></> : <><h2>你的代码港湾</h2><p className="repo-location">打开仓库，开始下一次提交。</p></>}</div>
        <nav aria-label="主导航"><button className={`nav-item ${view === 'changes' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('changes'); setSelection(null); }}><Icon name="changes" /><span>工作区</span>{repo && <b>{repo.entries.length}</b>}</button><button className={`nav-item ${view === 'history' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('history'); setSelection(null); }}><Icon name="history" /><span>提交历史</span></button><button className={`nav-item ${view === 'branches' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('branches'); setSelection(null); }}><Icon name="branch" /><span>分支管理</span></button></nav>
        {repo && <div className="sync-summary"><span className="eyebrow">REMOTE STATUS</span><div><span>待推送</span><b>↑ {repo.ahead}</b></div><div><span>待拉取</span><b>↓ {repo.behind}</b></div><small title={repo.upstream}>{repo.upstream || '尚未关联上游分支'}</small></div>}
        <div className="sidebar-bottom">{repo && <button className="quiet-button" onClick={showIdentity} disabled={!!busy}><Icon name="settings" size={16} />提交身份</button>}<button className={`quiet-button ${showLog ? 'accent-text' : ''}`} onClick={() => setShowLog(!showLog)} aria-expanded={showLog}><Icon name="terminal" size={16} />操作日志{activeActivity && <span className="live-dot" />}</button><small>LOCAL FIRST <span>·</span> {version || 'HarborGit'}</small></div>
      </aside>
      <main className="workspace">
        {error && <div className="error-banner" role="alert"><div><strong>{error.cancelled ? '操作已取消' : error.message}</strong>{error.command && <code>{error.command}</code>}{(error.stderr || error.stdout) && <details><summary>查看命令输出</summary><pre>{error.stderr || error.stdout}</pre></details>}</div><button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}><Icon name="close" size={16} /></button></div>}
        {notice && <div className="success-banner" role="status"><Icon name="check" size={15} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
        {!repo ? <div className="welcome"><div className="welcome-graphic"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="welcome-mark"><Icon name="branch" size={48} /></div><span className="orbit-dot" /></div><div className="eyebrow">A CLEAR VIEW OF YOUR CODE</div><h1>专注代码，<br />从容掌握每次改动。</h1><p>工作区、差异与提交，一处清晰呈现。<br />连接本机 Git，让工作流自然向前。</p><div className="welcome-actions"><button className="primary-button" onClick={showOpen} disabled={!!busy}><Icon name="folder" />打开本地仓库</button><button className="secondary-button" onClick={showClone} disabled={!!busy}><Icon name="download" />克隆仓库</button></div>{recent.length > 0 && <div className="recent-list"><div className="eyebrow">最近打开</div>{recent.slice(0, 5).map(item => <button key={item} onClick={() => void openRepo(item)} disabled={!!busy}><Icon name="folder" size={16} /><span><b>{basename(item)}</b><small>{item}</small></span><Icon name="chevron" size={15} /></button>)}</div>}</div> : <>
          <div className="workspace-toolbar"><div><span className="eyebrow">REPOSITORY / {view === 'changes' ? 'CHANGES' : view === 'history' ? 'HISTORY' : 'BRANCHES'}</span><h1>{view === 'changes' ? '工作区改动' : view === 'history' ? '提交历史' : '分支管理'}<span className="toolbar-subtitle">{view === 'changes' ? '检查、暂存，然后提交。' : view === 'history' ? '沿着提交，回看代码的来路。' : '让每条开发路径井然有序。'}</span></h1></div><div className="toolbar-buttons"><button className="secondary-button compact" disabled={!!busy} onClick={() => showRemote('fetch')}><Icon name="download" size={15} />Fetch</button><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress} onClick={() => showRemote('pull')}>↓ Pull</button><button className="secondary-button compact" disabled={!!busy || repo.unborn || repo.detached || repo.mergeInProgress} onClick={() => showRemote('push')}><Icon name="upload" size={15} />Push</button><button className="icon-button refresh-button" title="刷新仓库" aria-label="刷新仓库" disabled={!!busy} onClick={() => void refresh()}><Icon name="refresh" size={18} /></button></div></div>
          {repo.mergeInProgress && <div className="merge-banner"><Icon name="merge" /><div><strong>合并进行中</strong><span>{conflicts.length ? `${conflicts.length} 个冲突待解决。解决并暂存后，填写信息完成合并提交。` : '所有冲突已解决。检查暂存区后，提交以完成合并。'}</span></div><button className="secondary-button compact" disabled={!!busy} onClick={() => setModal('abortMerge')}>中止合并</button></div>}
          {view === 'changes' && <div className="changes-layout"><section className="changes-list" aria-label="文件状态"><div className="list-search"><input aria-label="筛选文件" placeholder="筛选文件…" value={fileFilter} onChange={e => setFileFilter(e.target.value)} /></div><div className="file-groups"><div className="file-group"><div className="group-heading"><span><i className="section-dot green" />暂存区 <b>{staged.length}</b></span><button title="全部取消暂存" aria-label="全部取消暂存" className="icon-button" disabled={!!busy || !staged.length} onClick={() => void unstage(staged.map(e => e.path))}><Icon name="minus" size={15} /></button></div>{staged.filter(e => e.path.toLowerCase().includes(fileFilter.toLowerCase())).map(e => fileButton(e, 'index'))}{!staged.length && <p className="list-empty">暂存文件后，在这里准备提交。</p>}</div><div className="file-group"><div className="group-heading"><span><i className="section-dot amber" />工作区 <b>{unstaged.length}</b></span><button title="全部暂存（不含冲突）" aria-label="全部暂存" className="icon-button" disabled={!!busy || !unstaged.some(e => !e.conflict)} onClick={() => void stage(unstaged.filter(e => !e.conflict).map(e => e.path))}><Icon name="plus" size={15} /></button></div>{unstaged.filter(e => e.path.toLowerCase().includes(fileFilter.toLowerCase())).map(e => fileButton(e, 'worktree'))}{!unstaged.length && <p className="list-empty">工作区干净，所有改动已妥善安放。</p>}</div></div><form className="commit-box" onSubmit={e => { e.preventDefault(); void run('提交中…', async () => { const next = await call('commit', { message }); if (next) setMessage(''); return next; }, '提交成功，可在历史中查看'); }}><div className="commit-box-heading"><strong>{repo.mergeInProgress ? '完成合并提交' : '创建提交'}</strong><small>{staged.length} 个暂存文件</small></div><textarea aria-label="提交信息" placeholder="描述这次改动…" value={message} onChange={e => setMessage(e.target.value)} rows={4} disabled={!!busy} /><div className="commit-identity"><span title={`${repo.userName} <${repo.userEmail}>`}>{repo.userName ? `${repo.userName} · ${repo.userEmail}` : '请先设置提交身份'}</span><button type="button" className="text-button" onClick={showIdentity} disabled={!!busy}>设置</button></div><button className="primary-button full" type="submit" disabled={!!busy || !message.trim() || (!staged.length && !repo.mergeInProgress) || !!conflicts.length}><Icon name="check" size={16} />提交到 {repo.detached ? 'HEAD' : repo.branch}</button></form></section><DiffViewer title={selection?.path || ''} subtitle={selection ? `${selection.area === 'index' ? 'HEAD → 暂存区' : '暂存区 → 工作区'}${selection.oldPath ? ` · 原路径 ${selection.oldPath}` : ''}` : undefined} diff={diff} loading={diffLoading} actions={selection && <>{conflicts.some(c => c.path === selection.path) ? <button className="secondary-button compact" disabled={!!busy} onClick={() => void showConflict(selection.path)}><Icon name="merge" size={15} />解决冲突</button> : <button className="secondary-button compact" disabled={!!busy} onClick={() => void (selection.area === 'index' ? unstage([selection.path]) : stage([selection.path]))}><Icon name={selection.area === 'index' ? 'minus' : 'plus'} size={15} />{selection.area === 'index' ? '取消暂存' : '暂存文件'}</button>}</>} /></div>}
          {view === 'history' && <div className="history-layout"><section className="history-list" aria-label="提交列表"><div className="group-heading"><span>提交记录 <b>{commits.length}</b></span><button className="icon-button" aria-label="刷新历史" disabled={!!busy} onClick={() => void loadHistory()}><Icon name="refresh" size={15} /></button></div><div className="commit-list-scroll">{commits.length ? commits.map(commit => <button key={commit.hash} className={`commit-row ${selectedCommit?.hash === commit.hash ? 'selected' : ''}`} onClick={() => void chooseCommit(commit)} aria-label={`查看提交 ${commit.subject}`}><span className="commit-node" /><div><strong>{commit.subject || '(无标题)'}</strong>{commit.refs && <span className="commit-ref">{commit.refs}</span>}<small>{commit.author}<span>{dateText(commit.date)}</span></small><code>{commit.shortHash}</code></div></button>) : <div className="list-empty">{repo.unborn ? '还没有提交。完成首次提交后，历史会出现在这里。' : '正在读取提交历史…'}</div>}<button className="load-more" disabled={!!busy || !commits.length} onClick={() => void loadHistory(true)}>加载更多提交</button></div></section><section className="history-detail">{selectedCommit ? <><div className="commit-detail-header"><div><code>{selectedCommit.shortHash}</code><span>{selectedCommit.author} · {dateText(selectedCommit.date)}</span></div><h2>{selectedCommit.subject}</h2>{selectedCommit.body && <pre>{selectedCommit.body}</pre>}<small>{selectedCommit.hash}</small></div><div className="history-files"><span className="eyebrow">变更文件 · {commitFiles.length}</span><div>{commitFiles.map(file => <button key={file.path} className={selection?.path === file.path ? 'selected' : ''} onClick={() => setSelection({ path: file.path, oldPath: file.oldPath, area: 'commit', commit: selectedCommit.hash })} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}><span className={`file-status status-${file.status[0]}`}>{file.status[0]}</span><span>{file.path}</span></button>)}</div></div><DiffViewer title={selection?.path || ''} subtitle={`提交 ${selectedCommit.shortHash} · ${selectedCommit.parents.length ? '与第一父提交比较' : '首次提交 · 与空树比较'}`} diff={diff} loading={diffLoading} /></> : <div className="center-message"><div className="empty-icon"><Icon name="history" size={34} /></div><h3>一条提交，一段进展</h3><p>选择左侧提交，查看文件变更与差异。</p></div>}</section></div>}
          {view === 'branches' && <section className="branches-view"><div className="branch-heading"><div><h2>本地分支</h2><p>当前分支 <strong>{repo.branch}</strong> · 切换时 Git 会保护未提交的改动</p></div><button className="primary-button compact" disabled={!!busy || repo.unborn || repo.mergeInProgress} onClick={() => { setBranchName(''); setBranchStart(''); setModal('createBranch'); }}><Icon name="plus" size={16} />创建分支</button></div><div className="branch-list">{branches.filter(b => !b.remote).map(branch => <div className={`branch-row ${branch.current ? 'current' : ''}`} key={branch.name}><div className="branch-symbol"><Icon name="branch" size={20} /></div><div className="branch-info"><strong>{branch.name}{branch.current && <span className="tag">当前分支</span>}</strong><small>{branch.subject || branch.hash.slice(0, 8)}</small>{branch.upstream && <span>跟踪 {branch.upstream}</span>}</div><div className="inline-actions"><button className="secondary-button compact" disabled={!!busy || branch.current || repo.mergeInProgress} onClick={() => void run('切换分支…', () => call('checkout', { name: branch.name }), `已切换到 ${branch.name}`)}>切换</button><button className="secondary-button compact" disabled={!!busy || branch.current || repo.mergeInProgress} onClick={() => void run('合并分支…', () => call('merge', { branch: branch.name }), '合并操作完成')}>合并到当前</button><button className="text-button danger-text" disabled={!!busy || branch.current || repo.mergeInProgress} onClick={() => { setDeleteBranch(branch.name); setModal('deleteBranch'); }}>删除</button></div></div>)}{!branches.some(b => !b.remote) && <p className="list-empty">首次提交后，当前分支会显示在这里。</p>}</div><div className="branch-heading remote-heading"><div><h2>远程分支</h2><p>先 Fetch，获取最新远程分支引用。</p></div></div><div className="branch-list">{branches.filter(b => b.remote).map(branch => <div className="branch-row" key={branch.name}><div className="branch-symbol remote-symbol"><Icon name="branch" size={20} /></div><div className="branch-info"><strong>{branch.name}</strong><small>{branch.subject}</small></div><div className="inline-actions"><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress} onClick={() => { setBranchName(branch.name.includes('/') ? branch.name.substring(branch.name.indexOf('/') + 1) : branch.name); setBranchStart(branch.name); setModal('createBranch'); }}>基于此创建分支</button><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress} onClick={() => void run('合并远程分支…', () => call('merge', { branch: branch.name }), '合并操作完成')}>合并到当前</button></div></div>)}{!branches.some(b => b.remote) && <p className="list-empty">暂无远程分支。</p>}</div></section>}
        </>}
        {showLog && <section className="activity-drawer" aria-label="操作日志"><div className="group-heading"><span><Icon name="terminal" size={15} />操作日志 <b>{activities.length}</b></span><div className="inline-actions"><button className="text-button" onClick={() => setActivities([])}>清空</button><button className="icon-button" aria-label="关闭日志" onClick={() => setShowLog(false)}><Icon name="close" size={15} /></button></div></div><div className="activity-scroll">{activities.length ? activities.map((event, i) => <div className={`activity-row ${event.kind === 'finish' && event.exitCode ? 'failed' : ''}`} key={`${event.id}-${i}`}><time>{dateText(event.time)}</time><span className={`activity-kind kind-${event.kind}`}>{event.kind === 'start' ? 'RUN' : event.kind === 'finish' ? event.exitCode === 0 ? 'OK' : 'END' : 'OUT'}</span><pre>{event.kind === 'start' ? event.command : event.text || event.command}</pre></div>) : <p className="list-empty">Git 命令与执行结果会显示在这里。</p>}</div></section>}
      </main>
    </div>
    <footer className="status-bar"><div>{busy ? <><span className="spinner small" /><span>{busy}</span></> : <><span className="status-dot" /><span>{repo ? `${repo.entries.length ? `${repo.entries.length} 个文件有改动` : '工作区干净'}${repo.mergeInProgress ? ' · 合并进行中' : ''}` : '就绪'}</span></>}{activeActivity && <button className="text-button cancel-task" onClick={() => void api.cancel(activeActivity.id)}>取消当前任务</button>}</div><div>{repo && <><Icon name="branch" size={13} /><span>{repo.detached ? repo.head.slice(0, 8) : repo.branch}</span><span className="status-separator">|</span></>}<span>Git CLI · Windows</span></div></footer>
    {modal && <div className="modal-backdrop" onClick={() => { if (!busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">HARBORGIT</span><h2 id="modal-title">{modal === 'open' ? '打开本地仓库' : modal === 'clone' ? '克隆仓库' : modal === 'createBranch' ? '创建分支' : modal === 'identity' ? '设置提交身份' : modal === 'deleteBranch' ? '删除本地分支' : modal === 'abortMerge' ? '中止当前合并' : remoteAction === 'fetch' ? 'Fetch · 获取远程更新' : remoteAction === 'pull' ? 'Pull · 拉取更新' : 'Push · 推送提交'}</h2></div><button className="icon-button" aria-label="关闭对话框" disabled={!!busy} onClick={() => setModal(null)}><Icon name="close" /></button></div><form onSubmit={e => void submitModal(e)}>
      {(modal === 'open' || modal === 'clone') && <>{modal === 'clone' && <label>仓库地址<input autoFocus aria-label="仓库地址" placeholder="https://… / SSH 地址 / 本地裸仓库路径" value={url} onChange={e => setUrl(e.target.value)} required disabled={!!busy} /></label>}<label>{modal === 'open' ? '仓库目录' : '完整目标目录'}<div className="input-with-button"><input autoFocus={modal === 'open'} aria-label={modal === 'open' ? '仓库目录' : '克隆目标目录'} placeholder={modal === 'open' ? '例如 D:\\Projects\\my-project' : '例如 D:\\Projects\\new-project'} value={path} onChange={e => setPath(e.target.value)} required disabled={!!busy} /><button type="button" className="secondary-button" onClick={() => void pick()} disabled={!!busy}>浏览</button></div></label><p className="form-help">{modal === 'clone' ? '填写新建目录的完整路径，或选择空目录。克隆完成后自动打开；耗时操作可在底部取消。' : '可以选择 Git 仓库根目录或其中的子目录。'}</p></>}
      {modal === 'createBranch' && <><label>新分支名称<input autoFocus aria-label="新分支名称" placeholder="feature/my-change" value={branchName} onChange={e => setBranchName(e.target.value)} required disabled={!!busy} /></label><label>起点（可选）<input aria-label="分支起点" placeholder="当前 HEAD" value={branchStart} onChange={e => setBranchStart(e.target.value)} disabled={!!busy} /></label><p className="form-help">创建成功后自动切换到新分支。</p></>}
      {modal === 'identity' && <><label>姓名<input autoFocus aria-label="提交者姓名" value={userName} onChange={e => setUserName(e.target.value)} required disabled={!!busy} /></label><label>邮箱<input aria-label="提交者邮箱" type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} required disabled={!!busy} /></label><p className="form-help">仅写入当前仓库的 user.name 与 user.email。</p></>}
      {modal === 'remote' && <><label>远程名称<select aria-label="远程名称" value={remoteName} onChange={e => setRemoteName(e.target.value)} disabled={!!busy}>{remotes.map(remote => <option key={remote.name} value={remote.name}>{remote.name}</option>)}{!remotes.length && <option value="">无远程仓库</option>}</select></label><div className="remote-address">{remotes.find(r => r.name === remoteName)?.[remoteAction === 'push' ? 'push' : 'fetch'] || '请先通过 Git CLI 为仓库配置远程地址。'}</div>{remoteAction !== 'fetch' && <label>远程分支<input aria-label="远程分支" value={remoteBranch} onChange={e => setRemoteBranch(e.target.value)} placeholder={repo?.branch || 'main'} disabled={!!busy} /></label>}<p className="form-help">{remoteAction === 'pull' ? '使用 --ff-only。出现分叉时保留工作区，请 Fetch 后在分支页手动合并远程分支。' : remoteAction === 'push' ? '普通推送；Git 将拒绝非快进更新。认证使用本机 Git 的凭据或 SSH 配置。' : '下载远程对象并更新引用，不修改工作区文件。'}</p></>}
      {modal === 'deleteBranch' && <p className="confirmation-copy">删除分支 <strong>{deleteBranch}</strong>？将使用 Git 的安全删除检查；不提供强制删除。</p>}
      {modal === 'abortMerge' && <p className="confirmation-copy">中止当前合并，并让 Git 尝试恢复合并前的工作区。合并期间所做的冲突解决编辑会被丢弃。</p>}
      {error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={!!busy} onClick={() => setModal(null)}>取消</button><button className={`primary-button ${modal === 'deleteBranch' || modal === 'abortMerge' ? 'danger-button' : ''}`} type="submit" disabled={!!busy || (modal === 'remote' && !remotes.length)}>{busy ? <><span className="spinner small" />{busy}</> : modal === 'open' ? '打开仓库' : modal === 'clone' ? '开始克隆' : modal === 'createBranch' ? '创建并切换' : modal === 'identity' ? '保存身份' : modal === 'deleteBranch' ? '确认删除' : modal === 'abortMerge' ? '中止合并' : '执行操作'}</button></div>
    </form></section></div>}
    {conflict && <div className="modal-backdrop conflict-backdrop"><section className="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><div className="modal-header"><div><span className="eyebrow">RESOLVE CONFLICT</span><h2 id="conflict-title">{conflict.path}</h2></div><button className="icon-button" aria-label="关闭冲突编辑器" disabled={!!busy} onClick={() => setConflict(null)}><Icon name="close" /></button></div><p className="conflict-intro">对照两侧内容，编辑合并结果后保存并暂存。使用一侧内容会替换整个文件。</p>{conflict.truncated && <div className="inline-notice">内容已截断，手动编辑已禁用。请在外部编辑器中处理，或完整采用一侧。</div>}{conflict.binary && <div className="inline-notice">二进制冲突：可完整采用一侧，或关闭后使用外部工具处理。</div>}<div className="conflict-columns"><section><h3>当前分支 · Ours{conflict.ours === null && <span>文件已删除</span>}</h3><pre>{conflict.binary ? '(二进制内容)' : conflict.ours ?? '(此侧无文件)'}</pre><button className="secondary-button compact" disabled={!!busy} onClick={() => void resolveConflict('ours')}>采用当前分支并暂存</button></section><section><h3>合并结果 · 可编辑</h3><textarea aria-label="冲突合并结果" spellCheck={false} value={resolvedText} onChange={e => setResolvedText(e.target.value)} disabled={!!busy || conflict.binary || conflict.truncated} /></section><section><h3>传入分支 · Theirs{conflict.theirs === null && <span>文件已删除</span>}</h3><pre>{conflict.binary ? '(二进制内容)' : conflict.theirs ?? '(此侧无文件)'}</pre><button className="secondary-button compact" disabled={!!busy} onClick={() => void resolveConflict('theirs')}>采用传入分支并暂存</button></section></div><details className="base-version"><summary>查看共同祖先 Base</summary><pre>{conflict.binary ? '(二进制内容)' : conflict.base ?? '(没有共同祖先版本)'}</pre></details>{error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}<div className="modal-actions"><button className="secondary-button" disabled={!!busy} onClick={() => setConflict(null)}>关闭</button><button className="primary-button" disabled={!!busy || conflict.binary || conflict.truncated} onClick={() => void resolveConflict('manual')}><Icon name="check" size={16} />保存合并结果并暂存</button></div></section></div>}
  </div>;
}
