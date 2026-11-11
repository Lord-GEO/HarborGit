import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Activity, Area, Branch, Commit, CommitFile, Conflict, Diff, Failure, GitTag, Remote, Repository, Requests, Responses, AiSuggestion } from '../shared/types';
import { CommitHistory } from './CommitHistory';
import { FileCheckbox } from './FileCheckbox';
import { RollbackIcon } from './RollbackIcon';
import { useResizablePanel } from './ResizableDivider';
import { AiSettingsDialog } from './AiSettingsDialog';
import { RemoteSettingsDialog } from './RemoteSettingsDialog';
import { SoftwareUpdates } from './SoftwareUpdates';
import { RebaseSavedChangesBanner } from './RebaseSavedChangesBanner';
import { RepositoryActionDialog, type RepositoryActionIntent, type RepositoryActionRequest } from './RepositoryActionDialog';
import { TagsPanel, TagDialog, type TagIntent } from './TagsPanel';
const ProjectTerminal = lazy(() => import('./ProjectTerminal').then(module => ({ default: module.ProjectTerminal })));

type View = 'changes' | 'history' | 'branches' | 'tags';
type FileArea = 'index' | 'worktree';
type CheckedFiles = Record<FileArea, Set<string>>;
const emptyCheckedFiles = (): CheckedFiles => ({ index: new Set(), worktree: new Set() });
function rollbackUnavailable(entry: Repository['entries'][number], area: FileArea, repository: Repository): string | undefined {
  if (entry.conflict) return '请先解决冲突';
  if (entry.index === '?' || entry.worktree === '?') return '未跟踪文件不会被撤销';
  if (repository.unborn || entry.index === 'A' || entry.index === 'C') return '该文件尚无 HEAD 版本，请先取消暂存；文件内容会保留';
  if (area === 'worktree' && entry.index === 'D') return '该文件已从暂存区删除，请先取消暂存或从暂存区撤销';
  return undefined;
}
type Selection = { path: string; area: Area; commit?: string; oldPath?: string };
type Modal = 'open' | 'clone' | 'createBranch' | 'remote' | 'remoteSettings' | 'identity' | 'deleteBranch' | 'abortMerge' | 'mergeInto' | null;
const emptyDiff: Diff = { text: '', binary: false, truncated: false };
const brandIcon = new URL('../../assets/harborgit.svg', import.meta.url).href;
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
    tag: <><path d="M3 3h8l10 10-8 8L3 11z" /><circle cx="7.5" cy="7.5" r="1" /></>,
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
    <div className="panel-top"><div className="diff-heading"><Icon name="changes" /><div><strong title={title}>{title || '选择一个文件查看差异'}</strong><small>{subtitle}</small></div></div><div className="inline-actions">{actions}</div></div>
    {loading ? <div className="center-message"><span className="spinner" />读取差异…</div> : !title ? <div className="center-message"><div className="empty-icon"><Icon name="changes" size={34} /></div><h3>选择文件查看差异</h3></div> : diff.binary ? <div className="center-message"><Icon name="changes" size={32} /><h3>二进制文件</h3><p>此文件无法以文本方式展示差异，仍可暂存与提交。</p></div> : !diff.text ? <div className="center-message"><Icon name="check" size={32} /><h3>没有文本差异</h3><p>可能是空文件、文件模式变化或内容相同。</p></div> : <div className="diff-scroll" tabIndex={0} aria-label="差异内容">
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

type ProjectTab = { id: string; initialRepo?: Repository };
export default function App() {
  const [tabs, setTabs] = useState<ProjectTab[]>(() => [{ id: crypto.randomUUID() }]);
  const [active, setActive] = useState('');
  const activeId = active || tabs[0]?.id;
  const activeRoot = tabs.find(tab => tab.id === activeId)?.initialRepo?.root;
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('harbor-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const [themeReady, setThemeReady] = useState(false);
  const [tabError, setTabError] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const showAiSettings = useCallback(() => setAiSettingsOpen(true), []);
  useEffect(() => {
    let cancelled = false;
    if (!window.harbor) { setThemeReady(true); return; }
    void window.harbor.appearance().then(value => { if (!cancelled) { if (value.saved) setTheme(value.theme); setThemeReady(true); } }).catch(() => { if (!cancelled) setThemeReady(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('harbor-theme', theme); } catch { /* Read-only storage. */ }
    if (themeReady && window.harbor) void window.harbor.setTheme(theme).catch(() => {});
  }, [theme, themeReady]);
  useEffect(() => { document.getElementById(`tab-${activeId}`)?.closest('.project-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeId, activeRoot, tabs.length]);
  const opened = useCallback((repo: Repository) => {
    if (!repo.sessionId) return;
    setTabs(current => current.some(t => t.id === repo.sessionId) ? current.map(t => t.id === repo.sessionId ? { ...t, initialRepo: repo } : t) : [...current, { id: repo.sessionId!, initialRepo: repo }]);
    setActive(repo.sessionId);
  }, []);
  const closeTab = useCallback(async (id: string) => {
    if (window.harbor) {
      const result = await window.harbor.closeRepository(id);
      if (!result.ok) { setTabError(result.error.message); return; }
    }
    setTabs(current => {
      const index = current.findIndex(t => t.id === id), next = current.filter(t => t.id !== id);
      if (!next.length) next.push({ id: crypto.randomUUID() });
      setActive(value => (value || current[0]?.id) === id ? next[Math.min(Math.max(index - 1, 0), next.length - 1)].id : value);
      return next;
    });
    setTabError('');
  }, []);
  const addTab = () => { const empty = tabs.find(t => !t.initialRepo); if (empty) { setActive(empty.id); return; } const tab = { id: crypto.randomUUID() }; setTabs(current => [...current, tab]); setActive(tab.id); };
  return <div className="desktop-shell">
    {window.harbor?.platform === 'win32' && <div className="window-titlebar" aria-label="窗口标题栏"><img src={brandIcon} alt="" /><span>HarborGit</span></div>}
    <div className="project-strip"><div className="project-tabs-area"><div className="project-tabs" role="tablist" aria-label="项目标签页">{tabs.map(tab => <div className={`project-tab ${tab.id === activeId ? 'active' : ''}`} key={tab.id}>
      <button role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} aria-selected={tab.id === activeId} title={tab.initialRepo?.root || '新项目'} onClick={() => { setActive(tab.id); setTabError(''); }}><Icon name={tab.initialRepo?.mergeWorkspace ? 'merge' : 'folder'} size={14} /><span>{tab.initialRepo?.mergeWorkspace ? `合并 → ${tab.initialRepo.mergeWorkspace.targetBranch}` : tab.initialRepo ? basename(tab.initialRepo.root) : '新项目'}</span></button>
      <button className="tab-close" aria-label={`关闭项目 ${tab.initialRepo ? basename(tab.initialRepo.root) : '新项目'}`} onClick={() => void closeTab(tab.id)}><Icon name="close" size={13} /></button>
    </div>)}</div><button className="icon-button new-project-tab" aria-label="新建项目标签" title="新建项目标签" onClick={addTab}><Icon name="plus" size={18} /></button></div><div className="project-strip-actions"><SoftwareUpdates /><button className="theme-toggle" aria-label="AI 设置" onClick={showAiSettings}>✦ AI 设置</button><button className="theme-toggle" disabled={!themeReady} aria-label={theme === 'dark' ? '切换为亮色主题' : '切换为暗色主题'} onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ 亮色' : '☾ 暗色'}</button></div></div>
    {tabError && <div className="tab-error" role="alert">{tabError}<button aria-label="关闭项目提示" onClick={() => setTabError('')}>×</button></div>}
    {aiSettingsOpen && <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} />}
    <div className="tab-panels">{tabs.map(tab => <div className="tab-panel" key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={tab.id !== activeId}><RepositoryView id={tab.id} active={tab.id === activeId} initialRepo={tab.initialRepo} onOpened={opened} onClose={closeTab} onAiSettings={showAiSettings} /></div>)}</div>
  </div>;
}

function RepositoryView({ id, active, initialRepo, onOpened, onClose, onAiSettings }: { id: string; active: boolean; initialRepo?: Repository; onOpened: (repo: Repository) => void; onClose: (id: string) => Promise<void>; onAiSettings(): void }) {
  const [repo, setRepo] = useState<Repository | null>(initialRepo || null);
  const navigation = useResizablePanel({ storageKey: 'navigation', initial: 212, min: 180, max: 320, remaining: 650, label: '调整导航宽度' });
  const filesPanel = useResizablePanel({ storageKey: 'files', initial: 320, min: 270, max: 620, remaining: 320, label: '调整文件列表宽度' });
  const historyPanel = useResizablePanel({ storageKey: 'history', initial: 400, min: 300, max: 760, remaining: 320, label: '调整历史列表宽度' });
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
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [checkedFiles, setCheckedFiles] = useState<CheckedFiles>(emptyCheckedFiles);
  useEffect(() => {
    setCheckedFiles(current => {
      if (!repo) return current.index.size || current.worktree.size ? emptyCheckedFiles() : current;
      const next = emptyCheckedFiles();
      for (const area of ['index', 'worktree'] as const) {
        for (const entry of repo.entries) {
          const present = area === 'index' ? isStaged(entry.index) : isChanged(entry.worktree);
          if (present && current[area].has(entry.path) && !rollbackUnavailable(entry, area, repo)) next[area].add(entry.path);
        }
      }
      return next.index.size === current.index.size && next.worktree.size === current.worktree.size ? current : next;
    });
  }, [repo]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [historyScope, setHistoryScope] = useState<'all' | 'current'>('all');
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyQuery = useRef(0);
  const historyLoaded = useRef(false);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const historyEpoch = useRef(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [tagIntent, setTagIntent] = useState<TagIntent | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [running, setRunning] = useState<Record<string, Activity>>({});
  const [showLog, setShowLog] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [actionIntent, setActionIntent] = useState<RepositoryActionIntent | null>(null);
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
  const [mergeTarget, setMergeTarget] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolvedText, setResolvedText] = useState('');
  const [version, setVersion] = useState('');
  const repoKey = useRef(initialRepo?.root || '');
  const latestRepository = useRef<Repository | null>(initialRepo || null);
  const activitySessions = useRef(new Set([id]));
  const api = window.harbor;

  const call = useCallback(async <K extends keyof Requests>(operation: K, payload: Requests[K]): Promise<Responses[K] | undefined> => {
    const session = (operation === 'open' || operation === 'clone') && repoKey.current ? crypto.randomUUID() : id;
    activitySessions.current.add(session);
    try { const result = await window.harbor.request(operation, payload, session); if (!result.ok) { setError(result.error); return undefined; } return result.data; }
    catch (e) { setError({ message: e instanceof Error ? e.message : String(e) }); return undefined; }
    finally { if (session !== id) activitySessions.current.delete(session); }
  }, [id]);

  useEffect(() => {
    if (!api) return;
    void api.recent().then(setRecent).catch(() => {});
    void api.version().then(setVersion).catch(() => {});
    return api.onActivity(event => {
      if (!event.sessionId || !activitySessions.current.has(event.sessionId)) return;
      setActivities(list => [...list, event].slice(-250));
      setRunning(current => { const next = { ...current }; if (event.kind === 'finish') delete next[event.id]; else next[event.id] = event; return next; });
    });
  }, [api]);

  const acceptRepo = useCallback((next: Repository) => {
    if (next.sessionId !== id) { onOpened(next); return; }
    const switched = repoKey.current !== next.root;
    repoKey.current = next.root;
    latestRepository.current = next;
    setRepo(next);
    if (switched) { ++historyEpoch.current; ++diffEpoch.current; setSelection(null); setSelectedCommit(null); setCommitFiles([]); setCommits([]); setBranches([]); setTags([]); setTagIntent(null); setDiff(emptyDiff); setMessage(''); setFileFilter(''); setCheckedFiles(emptyCheckedFiles()); setConflict(null); setView('changes'); }
    else setSelection(current => current?.area === 'commit' || (current && next.entries.some(e => e.path === current.path && (current.area === 'index' ? isStaged(e.index) && !e.conflict : isChanged(e.worktree) || e.conflict))) ? current : null);
    if (switched) onOpened(next);
    void window.harbor.recent().then(setRecent).catch(() => {});
  }, [id, onOpened]);

  const loadSupplementary = useCallback(async () => {
    const root = repoKey.current;
    const [nextBranches, nextRemotes, nextTags] = await Promise.all([call('branches', {}), call('remotes', {}), call('tags', {})]);
    if (repoKey.current !== root) return;
    if (nextBranches) setBranches(nextBranches);
    if (nextTags) setTags(nextTags);
    if (nextRemotes) { setRemotes(nextRemotes); setRemoteName(current => nextRemotes.some(r => r.name === current) ? current : nextRemotes[0]?.name || ''); }
  }, [call]);

  const loadHistory = useCallback(async (more = false, scope = historyScope) => {
    const root = repoKey.current, ticket = ++historyQuery.current;
    setHistoryLoading(true);
    try {
      const next = await call('history', { skip: more ? commits.length : 0, limit: 100, scope });
      if (next && root === repoKey.current && ticket === historyQuery.current) { historyLoaded.current = true; setCommits(current => more ? [...current, ...next.filter(c => !current.some(old => old.hash === c.hash))] : next); }
    } finally { if (ticket === historyQuery.current) setHistoryLoading(false); }
  }, [call, commits.length, historyScope]);
  const changeHistoryScope = (scope: 'all' | 'current') => {
    historyLoaded.current = false;
    ++historyEpoch.current; setHistoryScope(scope); setCommits([]); setSelectedCommit(null); setCommitFiles([]); setSelection(null); void loadHistory(false, scope);
  };

  const run = useCallback(async (label: string, action: () => Promise<Repository | undefined>, success?: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null); setNotice('');
    historyLoaded.current = false;
    try {
      const next = await action();
      if (next) { acceptRepo(next); if (success) setNotice(success); if (next.sessionId === id) { await loadSupplementary(); if (view === 'history') await loadHistory(); } }
      else if (repoKey.current) { const fresh = await call('refresh', {}); if (fresh) acceptRepo(fresh); }
      return next;
    } finally { busyRef.current = false; setBusy(''); }
  }, [acceptRepo, call, id, loadHistory, loadSupplementary, view]);

  // Backend-created tabs already carry a fresh repository snapshot. Read their
  // supplementary data once; selecting an existing tab must not refresh it.
  useEffect(() => { if (initialRepo) void loadSupplementary(); }, []);
  // Explicitly reopening an already-open path brings a new snapshot from the
  // backend. Apply that user-requested result without refreshing on activation.
  useEffect(() => {
    if (initialRepo && initialRepo !== latestRepository.current) {
      historyLoaded.current = false; acceptRepo(initialRepo); void loadSupplementary();
      if (view === 'history') void loadHistory();
    }
  }, [initialRepo]);

  useEffect(() => {
    const epoch = ++diffEpoch.current;
    if (!selection) { setDiff(emptyDiff); setDiffLoading(false); return; }
    setDiffLoading(true); setDiff(emptyDiff);
    void call('diff', selection).then(next => { if (epoch === diffEpoch.current) { if (next) setDiff(next); setDiffLoading(false); } });
  }, [selection, repo, call]);

  useEffect(() => { if (repo && view === 'history' && !historyLoaded.current) void loadHistory(); }, [view, repo?.root]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (active && repoKey.current && event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'Backquote') {
        if (modal || conflict || actionIntent || tagIntent) return;
        event.preventDefault(); setTerminalMounted(true); setShowTerminal(value => !value); setShowLog(false); return;
      }
      if ((event.target as HTMLElement | null)?.closest('.project-terminal')) return;
      if (!event.ctrlKey || event.altKey || event.shiftKey || !['KeyO', 'KeyR'].includes(event.code)) return;
      if (!active) return;
      event.preventDefault();
      if (busyRef.current || modal || conflict || actionIntent || tagIntent) return;
      if (event.code === 'KeyO') { setPath(''); setError(null); setModal('open'); }
      else if (repoKey.current) void run('刷新仓库…', () => call('refresh', {}));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, call, run, modal, conflict, actionIntent, tagIntent]);

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
  const showRemoteSettings = () => { setError(null); setModal('remoteSettings'); };
  const showIdentity = () => { setUserName(repo?.userName || ''); setUserEmail(repo?.userEmail || ''); setModal('identity'); };
  const showConflict = async (filePath: string) => { setError(null); const next = await call('conflict', { path: filePath }); if (next) { setConflict(next); setResolvedText(next.worktree); } };
  const resolveConflict = async (choice: 'ours' | 'theirs' | 'manual') => {
    if (!conflict) return;
    await run('保存冲突解决结果…', async () => { const next = await call('resolve', { path: conflict.path, choice, ...(choice === 'manual' ? { content: resolvedText } : {}) }); if (next) setConflict(null); return next; }, repo?.operation ? '冲突已解决并暂存，请使用上方继续操作' : repo?.rebaseSavedChanges?.status === 'restore-conflicts' ? '恢复冲突已解决并暂存，请检查后结束恢复，再提交' : '冲突已解决并暂存，请检查后提交');
  };
  const showRebase = (target = '') => {
    if (!repo) return;
    setError(null); setActionIntent({ kind: 'rebase', repository: repo, target: target || branches.find(branch => !branch.current)?.name || '' });
  };
  const showRebaseAtCommit = () => {
    if (!repo || !selectedCommit) return;
    setError(null); setActionIntent({ kind: 'rebase', repository: repo, target: '', targetCommit: selectedCommit });
  };
  const showHistoryAction = (kind: 'revert' | 'reset') => {
    if (!repo || !selectedCommit) return;
    setError(null); setActionIntent({ kind, repository: repo, commit: selectedCommit });
  };
  const showRollback = (entries: Repository['entries'], scope: 'worktree' | 'all') => {
    if (!repo || !entries.length) return;
    setError(null);
    const area = scope === 'all' ? 'index' : 'worktree';
    const unavailable = entries.map(entry => rollbackUnavailable(entry, area, repo)).find(Boolean);
    setActionIntent({ kind: 'rollback', repository: repo, paths: [...new Set(entries.map(entry => entry.path))],
      displayPaths: [...new Set(entries.flatMap(entry => [entry.originalPath, entry.path]).filter((value): value is string => !!value))], scope,
      ...(unavailable ? { unavailable } : {}) });
  };
  const executeRepositoryAction = async (request: RepositoryActionRequest) => {
    const priorSaved = repo?.rebaseSavedChanges;
    const labels = { rebaseSavedAction: '处理保存的改动…', rebase: '变基中…', revert: '创建反向提交…', reset: '重置当前分支…', rollback: '撤销文件修改…', rebaseAction: '处理变基状态…', revertAction: '处理反向提交状态…' };
    const execute = async () => {
      switch (request.operation) {
        case 'rebase': return call('rebase', request.payload);
        case 'revert': return call('revert', request.payload);
        case 'reset': return call('reset', request.payload);
        case 'rollback': return call('rollback', request.payload);
        case 'rebaseAction': return call('rebaseAction', request.payload);
        case 'revertAction': return call('revertAction', request.payload);
        case 'rebaseSavedAction': return call('rebaseSavedAction', request.payload);
      }
    };
    const next = await run(labels[request.operation], execute);
    if (next) {
      const saved = next.rebaseSavedChanges;
      const usesSavedChanges = ['rebase', 'rebaseAction', 'rebaseSavedAction'].includes(request.operation) && saved && (request.operation === 'rebaseSavedAction' || saved.ref !== priorSaved?.ref || priorSaved?.status !== 'restored');
      setNotice(next.operation ? '操作已暂停，请检查冲突并使用继续、跳过或中止' : usesSavedChanges && saved ? saved.message || (saved.status === 'restored' ? '保存的未提交改动已恢复，备份仍保留' : '保存的未提交改动等待恢复，请查看上方状态') : '仓库操作已完成');
    }
    if (next || latestRepository.current?.operation || latestRepository.current?.rebaseSavedChanges?.status === 'restore-conflicts' || (request.operation === 'rebase' && latestRepository.current?.rebaseSavedChanges && latestRepository.current.rebaseSavedChanges.status !== 'restored')) setActionIntent(null);
  };
  const restoreSavedChanges = async () => {
    const next = await run('恢复保存的未提交改动…', () => call('rebaseSavedAction', { action: 'restore' }));
    if (next) setNotice(next.rebaseSavedChanges?.message || (next.rebaseSavedChanges?.status === 'restore-conflicts' ? '恢复出现冲突，备份已保留；解决并暂存后请结束恢复' : next.rebaseSavedChanges?.status === 'restored' ? '保存的改动已恢复，备份仍保留' : '保存的改动恢复状态已更新'));
  };
  const continueOperation = async () => {
    if (!repo?.operation) return;
    const next = await run(repo.operation.kind === 'rebase' ? '继续变基…' : '继续反向提交…', () => repo.operation!.kind === 'rebase' ? call('rebaseAction', { action: 'continue' }) : call('revertAction', { action: 'continue' }));
    if (next) setNotice(next.operation ? '当前操作已继续，等待处理下一步' : (repo.operation.kind === 'rebase' && repo.rebaseSavedChanges?.status !== 'restored' ? next.rebaseSavedChanges?.message : undefined) || '当前操作已完成');
  };
  const showMergeInto = (target = '') => {
    setMergeTarget(target || branches.find(b => !b.remote && b.name !== repo?.branch)?.name || '');
    setError(null); setModal('mergeInto');
  };
  const finishWorkspace = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('结束合并工作区…'); setError(null);
    try { const next = await call('finishMergeWorkspace', {}); if (next) await onClose(id); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const generateAi = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('AI 生成提交消息…'); setError(null); setNotice('');
    try {
      const settings = await api.aiSettings();
      if (!settings.ok) { setError(settings.error); return; }
      if (!settings.data.model) { onAiSettings(); return; }
      const suggestion = await call('generateCommit', {});
      if (suggestion) { setAiSuggestion(suggestion); if (suggestion.stale) setNotice('生成期间暂存区已变化，请重新生成'); }
    } catch (e) { setError({ message: e instanceof Error ? e.message : String(e) }); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const applyAi = async () => {
    if (busyRef.current || !aiSuggestion) return;
    busyRef.current = true; setBusy('校验暂存区…'); setError(null);
    try {
      const tree = await call('stagedTree', {}); if (!tree) return;
      if (tree !== aiSuggestion.tree) { setAiSuggestion({ ...aiSuggestion, stale: true }); setError({ message: '暂存区已变化，请重新生成提交消息；现有草稿已保留' }); return; }
      setMessage(aiSuggestion.message); setAiSuggestion(null); setNotice('AI 提交消息已填入，请检查或编辑后提交');
    } finally { busyRef.current = false; setBusy(''); }
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
    else if (modal === 'mergeInto') await run('合并已提交内容…', async () => {
      const next = await call('mergeInto', { target: mergeTarget });
      if (!next) return undefined;
      setModal(null); setNotice(next.message);
      if (next.mergeRepository) onOpened(next.mergeRepository);
      return next.repository;
    });
  };

  if (!api) return <main className="desktop-required"><img className="brand-mark" src={brandIcon} alt="" /><h1>HarborGit</h1><p>请通过 Electron 桌面应用启动，以连接本机 Git。</p><code>npm start</code></main>;

  const staged = repo?.entries.filter(e => isStaged(e.index) && !e.conflict) || [];
  const unstaged = repo?.entries.filter(e => isChanged(e.worktree) || e.conflict) || [];
  const conflicts = repo?.entries.filter(e => e.conflict) || [];
  const operationInProgress = !!repo?.operation;
  const savedRecoveryPending = !!repo?.rebaseSavedChanges && repo.rebaseSavedChanges.status !== 'restored';
  const ordinaryWriteBlocked = operationInProgress || savedRecoveryPending;
  const savedRestoreConflicts = repo?.rebaseSavedChanges?.status === 'restore-conflicts';
  const blockHistoryAction = !!busy || !!repo?.mergeInProgress || ordinaryWriteBlocked || !!repo?.mergeWorkspace || !!repo?.unborn || !!repo?.detached;
  const oursLabel = savedRestoreConflicts ? '变基后的内容（Ours）' : repo?.operation?.kind === 'rebase' ? '目标基底（Ours）' : '当前分支 · Ours';
  const theirsLabel = savedRestoreConflicts ? '保存的未提交修改（Theirs）' : repo?.operation?.kind === 'rebase' ? '正在重放的提交（Theirs）' : repo?.operation?.kind === 'revert' ? '反向应用内容（Theirs）' : '传入分支 · Theirs';
  const oursButton = savedRestoreConflicts ? '采用变基后的内容并暂存' : repo?.operation?.kind === 'rebase' ? '采用目标基底并暂存' : '采用当前分支并暂存';
  const theirsButton = savedRestoreConflicts ? '采用保存的未提交修改并暂存' : repo?.operation?.kind === 'rebase' ? '采用正在重放的提交并暂存' : repo?.operation?.kind === 'revert' ? '采用反向应用内容并暂存' : '采用传入分支并暂存';
  const activeActivity = Object.values(running).at(-1);
  const fileButton = (entry: Repository['entries'][number], area: 'index' | 'worktree') => {
    const code = entry.conflict ? 'U' : area === 'index' ? entry.index : entry.worktree;
    const selected = selection?.path === entry.path && selection.area === area;
    return <div className={`file-row ${selected ? 'selected' : ''} ${checkedFiles[area].has(entry.path) ? 'bulk-selected' : ''}`} key={`${area}:${entry.path}`}>
      <FileCheckbox label={`选择${area === 'index' ? '暂存区' : '工作区'} ${entry.path}`} checked={checkedFiles[area].has(entry.path)} disabled={!!busy || !!repo?.mergeInProgress || ordinaryWriteBlocked || !!(repo && rollbackUnavailable(entry, area, repo))} title={repo ? rollbackUnavailable(entry, area, repo) : undefined} onChange={checked => setCheckedFiles(current => { const paths = new Set(current[area]); if (checked) paths.add(entry.path); else paths.delete(entry.path); return { ...current, [area]: paths }; })} />
      <button className="file-select" onClick={() => setSelection({ path: entry.path, oldPath: entry.originalPath, area })} title={entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path} aria-label={`${area === 'index' ? '暂存区' : '工作区'} ${entry.path}`}><span className={`file-status status-${code}`} title={statusLabels[code] || code}>{code}</span><span className="file-name">{basename(entry.path)}{entry.path.includes('/') && <small>{entry.path.substring(0, entry.path.lastIndexOf('/'))}</small>}</span></button>
      {entry.conflict ? <button className="icon-button" title="解决冲突" aria-label={`解决冲突 ${entry.path}`} disabled={!!busy} onClick={() => void showConflict(entry.path)}><Icon name="merge" size={15} /></button> : <button className="icon-button" title={area === 'index' ? '取消暂存' : '暂存文件'} aria-label={`${area === 'index' ? '取消暂存' : '暂存'} ${entry.path}`} disabled={!!busy} onClick={() => void (area === 'index' ? unstage([entry.path]) : stage([entry.path]))}><Icon name={area === 'index' ? 'minus' : 'plus'} size={16} /></button>}
      {!entry.conflict && !(area === 'worktree' && entry.worktree === '?') && <button className="icon-button file-rollback" title={area === 'index' ? '撤销暂存及工作区修改' : '撤销未暂存修改'} aria-label={`${area === 'index' ? '撤销暂存及工作区修改' : '撤销未暂存修改'} ${entry.path}`} disabled={!!busy || !!repo?.mergeInProgress || ordinaryWriteBlocked} onClick={() => showRollback([entry], area === 'index' ? 'all' : 'worktree')}><RollbackIcon /></button>}
    </div>;
  };
  const fileGroup = (entries: Repository['entries'], area: FileArea) => {
    if (!repo) return null;
    const label = area === 'index' ? '暂存区' : '工作区';
    const visible = entries.filter(entry => entry.path.toLowerCase().includes(fileFilter.toLowerCase()));
    const selectable = visible.filter(entry => !rollbackUnavailable(entry, area, repo));
    const chosen = visible.filter(entry => checkedFiles[area].has(entry.path) && !rollbackUnavailable(entry, area, repo));
    const blocked = !!busy || repo.mergeInProgress || ordinaryWriteBlocked;
    return <div className="file-group"><div className="group-heading"><span>
      <FileCheckbox label={`全选${label}可撤销文件`} checked={!!selectable.length && chosen.length === selectable.length}
        mixed={!!chosen.length && chosen.length < selectable.length} disabled={blocked || !selectable.length}
        title={`选择筛选结果中可撤销的${label}文件`} onChange={checked => setCheckedFiles(current => {
          const paths = new Set(current[area]);
          for (const entry of selectable) { if (checked) paths.add(entry.path); else paths.delete(entry.path); }
          return { ...current, [area]: paths };
        })} />
      <i className={`section-dot ${area === 'index' ? 'green' : 'amber'}`} />{label} <b>{entries.length}</b></span>
      <div className="inline-actions">{!!chosen.length && <button className="bulk-rollback"
        aria-label={area === 'index' ? '批量撤销暂存及工作区修改' : '批量撤销工作区修改'}
        title={area === 'index' ? `将所选 ${chosen.length} 个文件的暂存区和工作区恢复到 HEAD` : `撤销所选 ${chosen.length} 个文件的未暂存修改，保留暂存内容`}
        disabled={blocked} onClick={() => showRollback(chosen, area === 'index' ? 'all' : 'worktree')}><RollbackIcon />撤销 {chosen.length} 项</button>}
      <button title={area === 'index' ? '全部取消暂存' : '全部暂存（不含冲突）'} aria-label={area === 'index' ? '全部取消暂存' : '全部暂存'} className="icon-button"
        disabled={!!busy || !(area === 'index' ? entries.length : entries.some(entry => !entry.conflict))}
        onClick={() => void (area === 'index' ? unstage(entries.map(entry => entry.path)) : stage(entries.filter(entry => !entry.conflict).map(entry => entry.path)))}><Icon name={area === 'index' ? 'minus' : 'plus'} size={15} /></button></div></div>
      {visible.map(entry => fileButton(entry, area))}{!entries.length && <p className="list-empty">{area === 'index' ? '暂无暂存文件' : '工作区干净'}</p>}
    </div>;
  };
  const selectedEntry = selection ? repo?.entries.find(entry => entry.path === selection.path) : undefined;
  const diffActions = selection && <>{selectedEntry?.conflict ? <button className="secondary-button compact" disabled={!!busy} onClick={() => void showConflict(selection.path)}><Icon name="merge" size={15} />解决冲突</button> : <><button className="secondary-button compact" disabled={!!busy} onClick={() => void (selection.area === 'index' ? unstage([selection.path]) : stage([selection.path]))}><Icon name={selection.area === 'index' ? 'minus' : 'plus'} size={15} />{selection.area === 'index' ? '取消暂存' : '暂存文件'}</button>{selectedEntry && !(selection.area === 'worktree' && selectedEntry.worktree === '?') && <button className="text-button danger-text diff-rollback" disabled={!!busy || !!repo?.mergeInProgress || ordinaryWriteBlocked} onClick={() => showRollback([selectedEntry], selection.area === 'index' ? 'all' : 'worktree')}><RollbackIcon />{selection.area === 'index' ? '撤销暂存及工作区修改' : '撤销未暂存修改'}</button>}</>}</>;

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><img className="brand-mark" src={brandIcon} alt="" /><strong>Harbor<span>Git</span></strong></div><div className="header-actions"><button className="quiet-button" onClick={showOpen} disabled={!!busy}><Icon name="folder" size={16} />打开仓库</button><button className="quiet-button" onClick={showClone} disabled={!!busy}><Icon name="download" size={16} />克隆</button></div></header>
    <div className="main-shell">
      <aside className="sidebar" style={navigation.panelStyle}><div className="sidebar-top">{repo ? <><h2 title={repo.root}>{basename(repo.root)}</h2><div className="current-branch"><Icon name="branch" size={16} /><span>{repo.detached ? '分离 HEAD' : repo.branch}</span>{repo.unborn && <span className="tag">空仓库</span>}</div></> : <><h2>尚未打开仓库</h2></>}</div>
        <nav aria-label="主导航"><button className={`nav-item ${view === 'changes' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('changes'); setSelection(null); }}><Icon name="changes" /><span>工作区</span>{repo && <b>{repo.entries.length}</b>}</button><button className={`nav-item ${view === 'history' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('history'); setSelection(null); }}><Icon name="history" /><span>提交历史</span></button><button className={`nav-item ${view === 'branches' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('branches'); setSelection(null); }}><Icon name="branch" /><span>分支管理</span></button><button className={`nav-item ${view === 'tags' ? 'active' : ''}`} disabled={!repo || !!busy} onClick={() => { setView('tags'); setSelection(null); }}><Icon name="tag" /><span>标签管理</span></button></nav>
        {repo && <div className="sync-summary"><div><span>待推送</span><b>↑ {repo.ahead}</b></div><div><span>待拉取</span><b>↓ {repo.behind}</b></div><small title={repo.upstream}>{repo.upstream || '尚未关联上游分支'}</small></div>}
        <div className="sidebar-bottom">{repo && <><button className={`quiet-button ${showTerminal ? 'accent-text' : ''}`} aria-label="打开项目终端" aria-expanded={showTerminal} title="项目终端 · Ctrl+`" onClick={() => { setTerminalMounted(true); setShowTerminal(value => !value); setShowLog(false); }}><Icon name="terminal" size={16} />终端</button><button className="quiet-button" onClick={showRemoteSettings} disabled={!!busy || savedRecoveryPending}><Icon name="settings" size={16} />远程仓库</button><button className="quiet-button" onClick={showIdentity} disabled={!!busy}><Icon name="settings" size={16} />提交身份</button></>}<button className={`quiet-button ${showLog ? 'accent-text' : ''}`} onClick={() => { setShowLog(!showLog); setShowTerminal(false); }} aria-expanded={showLog}><Icon name="terminal" size={16} />操作日志{activeActivity && <span className="live-dot" />}</button><small>{version ? `v${version}` : 'HarborGit'}</small></div>
      </aside>
      {navigation.divider}
      <main className="workspace">
        {error && <div className="error-banner" role="alert"><div><strong>{error.cancelled ? '操作已取消' : error.message}</strong>{error.command && <code>{error.command}</code>}{(error.stderr || error.stdout) && <details><summary>查看命令输出</summary><pre>{error.stderr || error.stdout}</pre></details>}</div><button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}><Icon name="close" size={16} /></button></div>}
        {notice && <div className={`success-banner ${savedRecoveryPending ? 'recovery-notice' : ''}`} role="status"><Icon name="check" size={15} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
        {!repo ? <div className="welcome"><div className="welcome-mark"><Icon name="branch" size={36} /></div><h1>打开仓库，开始工作</h1><div className="welcome-actions"><button className="primary-button" onClick={showOpen} disabled={!!busy}><Icon name="folder" />打开本地仓库</button><button className="secondary-button" onClick={showClone} disabled={!!busy}><Icon name="download" />克隆仓库</button></div>{recent.length > 0 && <div className="recent-list"><div className="eyebrow">最近打开</div>{recent.slice(0, 5).map(item => <button key={item} onClick={() => void openRepo(item)} disabled={!!busy}><Icon name="folder" size={16} /><span><b>{basename(item)}</b><small>{item}</small></span><Icon name="chevron" size={15} /></button>)}</div>}</div> : <>
          <div className="workspace-toolbar"><h1>{view === 'changes' ? '工作区改动' : view === 'history' ? '提交历史' : view === 'tags' ? '标签管理' : '分支管理'}</h1><div className="toolbar-buttons"><button className="secondary-button compact" disabled={!!busy || savedRecoveryPending} onClick={() => showRemote('fetch')}><Icon name="download" size={15} />Fetch</button><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => showRemote('pull')}>↓ Pull</button><button className="secondary-button compact" disabled={!!busy || repo.unborn || repo.detached || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => showRemote('push')}><Icon name="upload" size={15} />Push</button><button className="icon-button refresh-button" title="刷新仓库" aria-label="刷新仓库" disabled={!!busy} onClick={() => void refresh()}><Icon name="refresh" size={18} /></button></div></div>
          {repo.mergeWorkspace && <div className="merge-workspace-banner"><Icon name="merge" /><div><strong>独立合并工作区 · {repo.mergeWorkspace.sourceBranch} → {repo.mergeWorkspace.targetBranch}</strong><span>原项目中的未提交改动已保留。请在这里解决并提交，或中止后结束此工作区。</span></div><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress || ordinaryWriteBlocked || !!repo.entries.length} onClick={() => void finishWorkspace()}>结束并关闭合并标签</button></div>}
          {repo.operation && <div className="operation-banner" aria-label="仓库操作状态"><Icon name={repo.operation.kind === 'rebase' ? 'branch' : 'history'} /><div><strong>{repo.operation.kind === 'rebase' ? '变基进行中' : '反向提交进行中'}{repo.operation.step !== undefined && <span className="operation-step">第 {repo.operation.step}{repo.operation.total ? ` / ${repo.operation.total}` : ''} 步</span>}</strong><span>{repo.operation.branch || repo.branch}{repo.operation.onto ? ` → ${repo.operation.onto}` : ''}{repo.operation.commit ? ` · 当前提交 ${repo.operation.commit.slice(0, 12)}` : ''}</span><span>{conflicts.length ? `${conflicts.length} 个冲突待解决。解决并暂存后，使用“继续”完成当前步骤。` : '请检查已暂存的解决结果，然后继续当前操作。'}</span></div><div className="operation-controls"><button className="primary-button compact" disabled={!!busy || !!conflicts.length} onClick={() => void continueOperation()}>{repo.operation.kind === 'rebase' ? '继续变基' : '继续反向提交'}</button>{repo.operation.kind === 'rebase' && <button className="secondary-button compact" disabled={!!busy} onClick={() => { setError(null); setActionIntent({ kind: 'rebaseAction', action: 'skip', repository: repo }); }}>跳过当前提交</button>}<button className="secondary-button compact" disabled={!!busy} onClick={() => { setError(null); setActionIntent(repo.operation!.kind === 'rebase' ? { kind: 'rebaseAction', action: 'abort', repository: repo } : { kind: 'revertAction', action: 'abort', repository: repo }); }}>{repo.operation.kind === 'rebase' ? '中止变基' : '中止反向提交'}</button></div></div>}
          {repo.rebaseSavedChanges && <RebaseSavedChangesBanner repository={repo} busy={!!busy} onRestore={() => void restoreSavedChanges()} onConfirm={action => { setError(null); setActionIntent({ kind: 'rebaseSavedAction', action, repository: repo }); }} />}
          {repo.historyBackup && <div className="history-backup" aria-label="提交恢复引用"><span>操作前提交已保存到</span><code>{repo.historyBackup}</code><small>仅保留原提交，不备份未提交改动。</small></div>}
          {repo.mergeInProgress && !repo.operation && <div className="merge-banner"><Icon name="merge" /><div><strong>合并进行中</strong><span>{conflicts.length ? `${conflicts.length} 个冲突待解决。解决并暂存后，填写信息完成合并提交。` : '所有冲突已解决。检查暂存区后，提交以完成合并。'}</span></div><button className="secondary-button compact" disabled={!!busy} onClick={() => setModal('abortMerge')}>中止合并</button></div>}
          {view === 'changes' && <div className="changes-layout"><section className="changes-list" aria-label="文件状态" style={filesPanel.panelStyle}><div className="list-search"><input aria-label="筛选文件" placeholder="筛选文件…" value={fileFilter} onChange={e => { setFileFilter(e.target.value); setCheckedFiles(emptyCheckedFiles()); }} /></div><div className="file-groups">{fileGroup(staged, 'index')}{fileGroup(unstaged, 'worktree')}</div><form className="commit-box" onSubmit={e => { e.preventDefault(); if (repo.operation || savedRecoveryPending) return; void run('提交中…', async () => { const next = await call('commit', { message }); if (next) setMessage(''); return next; }, '提交成功，可在历史中查看'); }}><div className="commit-box-heading"><strong>{repo.operation ? repo.operation.kind === 'rebase' ? '变基进行中' : '反向提交进行中' : savedRecoveryPending ? '保存的改动待恢复' : repo.mergeInProgress ? '完成合并提交' : '创建提交'}</strong></div><div className="ai-commit-actions"><button type="button" className="secondary-button compact" title="将暂存区差异发送至已配置的 AI 服务，生成提交信息" disabled={!!busy || !staged.length || !!conflicts.length} onClick={() => void generateAi()}>✦ AI 生成</button></div>{aiSuggestion && <section className="ai-suggestion" aria-label="AI 提交消息候选"><strong>AI 候选 · {aiSuggestion.fileCount} 个暂存文件</strong><pre>{aiSuggestion.message}</pre>{aiSuggestion.truncated && <small>差异较大，基于截断内容生成，请检查。</small>}{aiSuggestion.stale && <small>暂存区已变化，请重新生成。</small>}<div><button type="button" className="secondary-button compact" disabled={!!busy || aiSuggestion.stale} onClick={() => void applyAi()}>应用到提交信息</button><button type="button" className="text-button" disabled={!!busy} onClick={() => setAiSuggestion(null)}>关闭候选</button></div></section>}<textarea aria-label="提交信息" placeholder="描述这次改动…" value={message} onChange={e => setMessage(e.target.value)} rows={4} disabled={!!busy} /><div className="commit-identity"><span title={`${repo.userName} <${repo.userEmail}>`}>{repo.userName || '请先设置提交身份'}</span><button type="button" className="text-button" onClick={showIdentity} disabled={!!busy}>设置</button></div><div className="commit-submit"><button className="primary-button full" type="submit" disabled={!!busy || ordinaryWriteBlocked || !message.trim() || (!staged.length && !repo.mergeInProgress) || !!conflicts.length}><Icon name="check" size={16} />{savedRecoveryPending && !operationInProgress ? '请先完成改动恢复' : operationInProgress ? '请使用上方继续操作' : `提交到 ${repo.detached ? 'HEAD' : repo.branch}`}</button></div></form></section>{filesPanel.divider}<DiffViewer title={selection?.path || ''} subtitle={selection ? `${selection.area === 'index' ? 'HEAD → 暂存区' : '暂存区 → 工作区'}${selection.oldPath ? ` · 原路径 ${selection.oldPath}` : ''}` : undefined} diff={diff} loading={diffLoading} actions={diffActions} /></div>}
          {view === 'history' && <div className="history-layout"><CommitHistory style={historyPanel.panelStyle} commits={commits} branches={branches} selected={selectedCommit?.hash} scope={historyScope} loading={historyLoading} busy={!!busy} onScope={changeHistoryScope} onSelect={commit => void chooseCommit(commit)} onRefresh={() => void loadHistory()} onMore={() => void loadHistory(true)} />{historyPanel.divider}<section className="history-detail">{selectedCommit ? <><div className="commit-detail-header"><div><code title={selectedCommit.hash}>{selectedCommit.shortHash}</code><span>{selectedCommit.author} · {dateText(selectedCommit.date)}</span></div><h2>{selectedCommit.subject}</h2>{selectedCommit.body && <pre>{selectedCommit.body}</pre>}<div className="history-commit-actions"><button className="secondary-button compact" aria-label="给所选提交创建标签" disabled={!!busy || ordinaryWriteBlocked} onClick={() => { setError(null); setTagIntent({ kind: 'create', target: selectedCommit.hash, subject: selectedCommit.subject }); }}><Icon name="tag" size={14} />创建标签</button><button className="secondary-button compact" aria-label="将分支变基到所选提交" disabled={blockHistoryAction} onClick={showRebaseAtCommit}>变基到此提交</button><button className="secondary-button compact" aria-label="Revert 所选提交" disabled={blockHistoryAction} onClick={() => showHistoryAction('revert')}>反向提交</button><button className="secondary-button compact" aria-label="Reset 当前分支到所选提交" disabled={blockHistoryAction} onClick={() => showHistoryAction('reset')}>重置到此提交</button></div></div><div className="history-files"><span className="eyebrow">变更文件 · {commitFiles.length}</span><div>{commitFiles.map(file => <button key={file.path} className={selection?.path === file.path ? 'selected' : ''} onClick={() => setSelection({ path: file.path, oldPath: file.oldPath, area: 'commit', commit: selectedCommit.hash })} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}><span className={`file-status status-${file.status[0]}`}>{file.status[0]}</span><span>{file.path}</span></button>)}</div></div><DiffViewer title={selection?.path || ''} subtitle={`提交 ${selectedCommit.shortHash} · ${selectedCommit.parents.length ? '与第一父提交比较' : '首次提交 · 与空树比较'}`} diff={diff} loading={diffLoading} /></> : <div className="center-message"><div className="empty-icon"><Icon name="history" size={34} /></div><h3>选择提交查看变更</h3></div>}</section></div>}
          {view === 'tags' && <TagsPanel tags={tags} busy={!!busy} blocked={ordinaryWriteBlocked} canCreate={!repo.unborn && !!repo.head} onCreate={() => { setError(null); setTagIntent({ kind: 'create', target: repo.head, subject: '当前 HEAD · ' + repo.branch }); }} onPush={tag => { setError(null); setTagIntent({ kind: 'push', tag }); }} onHistory={() => { setView('history'); setSelection(null); }} />}
          {view === 'branches' && <section className="branches-view"><div className="branch-heading"><div><h2>本地分支</h2></div><button className="primary-button compact" disabled={!!busy || repo.unborn || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => { setBranchName(''); setBranchStart(''); setModal('createBranch'); }}><Icon name="plus" size={16} />创建分支</button></div><div className="merge-direction"><button className="secondary-button" disabled={!!busy || repo.unborn || repo.detached || repo.mergeInProgress || ordinaryWriteBlocked || !!repo.mergeWorkspace} onClick={() => showMergeInto()}><Icon name="merge" size={16} />将当前分支合并到…</button></div><div className="rebase-direction"><button className="secondary-button" aria-label="将当前分支变基到目标分支" disabled={blockHistoryAction} onClick={() => showRebase()}><Icon name="branch" size={16} />将当前分支变基到…</button></div><div className="branch-list">{branches.filter(b => !b.remote).map(branch => <div className={`branch-row ${branch.current ? 'current' : ''}`} key={branch.name}><div className="branch-symbol"><Icon name="branch" size={20} /></div><div className="branch-info"><strong>{branch.name}{branch.current && <span className="tag">当前分支</span>}</strong><small>{branch.subject || branch.hash.slice(0, 8)}</small>{branch.upstream && <span>跟踪 {branch.upstream}</span>}</div><div className="inline-actions"><button className="secondary-button compact" disabled={!!busy || branch.current || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => void run('切换分支…', () => call('checkout', { name: branch.name }), `已切换到 ${branch.name}`)}>切换</button><button className="secondary-button compact" disabled={!!busy || branch.current || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => void run('合并分支…', () => call('merge', { branch: branch.name }), '合并操作完成')}>合并到当前</button><button className="secondary-button compact" aria-label={`将当前分支变基到 ${branch.name}`} disabled={blockHistoryAction || branch.current} onClick={() => showRebase(branch.name)}>变基到此分支</button><button className="text-button danger-text" disabled={!!busy || branch.current || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => { setDeleteBranch(branch.name); setModal('deleteBranch'); }}>删除</button></div></div>)}{!branches.some(b => !b.remote) && <p className="list-empty">首次提交后，当前分支会显示在这里。</p>}</div><div className="branch-heading remote-heading"><div><h2>远程分支</h2></div></div><div className="branch-list">{branches.filter(b => b.remote).map(branch => <div className="branch-row" key={branch.name}><div className="branch-symbol remote-symbol"><Icon name="branch" size={20} /></div><div className="branch-info"><strong>{branch.name}</strong><small>{branch.subject}</small></div><div className="inline-actions"><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => { setBranchName(branch.name.includes('/') ? branch.name.substring(branch.name.indexOf('/') + 1) : branch.name); setBranchStart(branch.name); setModal('createBranch'); }}>基于此创建分支</button><button className="secondary-button compact" disabled={!!busy || repo.mergeInProgress || ordinaryWriteBlocked} onClick={() => void run('合并远程分支…', () => call('merge', { branch: branch.name }), '合并操作完成')}>合并到当前</button><button className="secondary-button compact" aria-label={`将当前分支变基到 ${branch.name}`} disabled={blockHistoryAction} onClick={() => showRebase(branch.name)}>变基到此分支</button></div></div>)}{!branches.some(b => b.remote) && <p className="list-empty">暂无远程分支。</p>}</div></section>}
        </>}
        {repo && terminalMounted && <Suspense fallback={<div className="terminal-preparing">正在准备终端…</div>}><ProjectTerminal sessionId={id} root={repo.root} visible={showTerminal} active={active} onHide={() => setShowTerminal(false)} /></Suspense>}
        {showLog && <section className="activity-drawer" aria-label="操作日志"><div className="group-heading"><span><Icon name="terminal" size={15} />操作日志 <b>{activities.length}</b></span><div className="inline-actions"><button className="text-button" onClick={() => setActivities([])}>清空</button><button className="icon-button" aria-label="关闭日志" onClick={() => setShowLog(false)}><Icon name="close" size={15} /></button></div></div><div className="activity-scroll">{activities.length ? activities.map((event, i) => <div className={`activity-row ${event.kind === 'finish' && event.exitCode ? 'failed' : ''}`} key={`${event.id}-${i}`}><time>{dateText(event.time)}</time><span className={`activity-kind kind-${event.kind}`}>{event.kind === 'start' ? 'RUN' : event.kind === 'finish' ? event.exitCode === 0 ? 'OK' : 'END' : 'OUT'}</span><pre>{event.kind === 'start' ? event.command : event.text || event.command}</pre></div>) : <p className="list-empty">Git 命令与执行结果会显示在这里。</p>}</div></section>}
      </main>
    </div>
    <footer className="status-bar"><div>{busy ? <><span className="spinner small" /><span>{busy}</span></> : <><span className="status-dot" /><span>{repo ? `${repo.entries.length ? `${repo.entries.length} 个文件有改动` : '工作区干净'}${repo.operation ? repo.operation.kind === 'rebase' ? ' · 变基进行中' : ' · 反向提交进行中' : repo.mergeInProgress ? ' · 合并进行中' : ''}` : '就绪'}</span></>}{activeActivity && <button className="text-button cancel-task" onClick={() => void api.cancel(activeActivity.id)}>取消当前任务</button>}</div><div>{repo && <><Icon name="branch" size={13} /><span>{repo.detached ? repo.head.slice(0, 8) : repo.branch}</span></>}</div></footer>
    {tagIntent && <TagDialog key={tagIntent.kind === 'create' ? tagIntent.target : tagIntent.tag.objectId} intent={tagIntent} remotes={remotes} busy={!!busy} error={error} onClose={() => setTagIntent(null)} onManageRemotes={() => { setTagIntent(null); showRemoteSettings(); }} onCreate={async input => { const next = await run('创建标签…', () => call('createTag', input), '标签已创建，可在列表中选择远程推送'); if (next) { setTagIntent(null); setView('tags'); } return next; }} onPush={async input => { const next = await run('推送标签…', () => call('pushTag', input), `标签 ${input.name} 已推送到 ${input.remote}`); if (next) setTagIntent(null); return next; }} />}
    {actionIntent && <RepositoryActionDialog intent={actionIntent} branches={branches} busy={!!busy} error={error} onClose={() => setActionIntent(null)} onExecute={executeRepositoryAction} />}
    {modal === 'remoteSettings' && <RemoteSettingsDialog remotes={remotes} busy={!!busy} error={error} onClearError={() => setError(null)} onClose={() => setModal(null)} onSave={input => run('保存远程仓库…', () => call('saveRemote', input), '远程地址已保存，可以执行 Fetch、Pull 或 Push')} onRemove={name => run('删除远程配置…', () => call('removeRemote', { name }), '已删除本地远程配置')} />}
    {modal && modal !== 'remoteSettings' && <div className="modal-backdrop" onClick={() => { if (!busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">HARBORGIT</span><h2 id="modal-title">{modal === 'open' ? '打开本地仓库' : modal === 'clone' ? '克隆仓库' : modal === 'createBranch' ? '创建分支' : modal === 'identity' ? '设置提交身份' : modal === 'deleteBranch' ? '删除本地分支' : modal === 'abortMerge' ? '中止当前合并' : modal === 'mergeInto' ? '合并已提交内容到其他分支' : remoteAction === 'fetch' ? 'Fetch · 获取远程更新' : remoteAction === 'pull' ? 'Pull · 拉取更新' : 'Push · 推送提交'}</h2></div><button className="icon-button" aria-label="关闭对话框" disabled={!!busy} onClick={() => setModal(null)}><Icon name="close" /></button></div><form onSubmit={e => void submitModal(e)}>
      {(modal === 'open' || modal === 'clone') && <>{modal === 'clone' && <label>仓库地址<input autoFocus aria-label="仓库地址" placeholder="https://… / SSH 地址 / 本地裸仓库路径" value={url} onChange={e => setUrl(e.target.value)} required disabled={!!busy} /></label>}<label>{modal === 'open' ? '仓库目录' : '完整目标目录'}<div className="input-with-button"><input autoFocus={modal === 'open'} aria-label={modal === 'open' ? '仓库目录' : '克隆目标目录'} placeholder={modal === 'open' ? '例如 D:\\Projects\\my-project' : '例如 D:\\Projects\\new-project'} value={path} onChange={e => setPath(e.target.value)} required disabled={!!busy} /><button type="button" className="secondary-button" onClick={() => void pick()} disabled={!!busy}>浏览</button></div></label><p className="form-help">{modal === 'clone' ? '填写新建目录的完整路径，或选择空目录。克隆完成后自动打开；耗时操作可在底部取消。' : '可以选择 Git 仓库根目录或其中的子目录。'}</p></>}
      {modal === 'createBranch' && <><label>新分支名称<input autoFocus aria-label="新分支名称" placeholder="feature/my-change" value={branchName} onChange={e => setBranchName(e.target.value)} required disabled={!!busy} /></label><label>起点（可选）<input aria-label="分支起点" placeholder="当前 HEAD" value={branchStart} onChange={e => setBranchStart(e.target.value)} disabled={!!busy} /></label><p className="form-help">创建成功后自动切换到新分支。</p></>}
      {modal === 'mergeInto' && <><label>目标分支<select autoFocus aria-label="合并目标分支" value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} required disabled={!!busy}><option value="">请选择目标分支</option>{branches.filter(b => !b.remote && b.name !== repo?.branch).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}</select></label><div className="merge-summary"><strong>{repo?.branch} → {mergeTarget || '选择目标分支'}</strong><p>仅合并当前分支已有的提交。当前项目的暂存、未暂存和未跟踪文件原样保留；无需切换分支。</p><p>如有提交冲突，将在独立标签页中解决。已在其他工作区检出的目标分支会受到保护。</p></div></>}
      {modal === 'identity' && <><label>姓名<input autoFocus aria-label="提交者姓名" value={userName} onChange={e => setUserName(e.target.value)} required disabled={!!busy} /></label><label>邮箱<input aria-label="提交者邮箱" type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} required disabled={!!busy} /></label><p className="form-help">仅写入当前仓库的 user.name 与 user.email。</p></>}
      {modal === 'remote' && <><label>远程名称<select aria-label="远程名称" value={remoteName} onChange={e => setRemoteName(e.target.value)} disabled={!!busy}>{remotes.map(remote => <option key={remote.name} value={remote.name}>{remote.name}</option>)}{!remotes.length && <option value="">无远程仓库</option>}</select></label><div className="remote-address">{remotes.find(r => r.name === remoteName)?.[remoteAction === 'push' ? 'push' : 'fetch'] || '尚未配置远程仓库，请点击下方按钮添加地址。'}</div><button type="button" className="text-button remote-config-link" disabled={!!busy} onClick={showRemoteSettings}>{remotes.length ? '管理远程仓库地址' : '添加远程仓库地址'}</button>{remoteAction !== 'fetch' && <label>远程分支<input aria-label="远程分支" value={remoteBranch} onChange={e => setRemoteBranch(e.target.value)} placeholder={repo?.branch || 'main'} disabled={!!busy} /></label>}<p className="form-help">{remoteAction === 'pull' ? '使用 --ff-only。出现分叉时保留工作区，请 Fetch 后在分支页手动合并远程分支。' : remoteAction === 'push' ? '普通推送；Git 将拒绝非快进更新。' : '下载远程对象并更新引用，不修改工作区文件。'} HTTPS 首次访问可能打开系统登录窗口或浏览器，请完成授权；SSH 使用本机密钥。</p></>}
      {modal === 'deleteBranch' && <p className="confirmation-copy">删除分支 <strong>{deleteBranch}</strong>？将使用 Git 的安全删除检查；不提供强制删除。</p>}
      {modal === 'abortMerge' && <p className="confirmation-copy">中止当前合并，并让 Git 尝试恢复合并前的工作区。合并期间所做的冲突解决编辑会被丢弃。</p>}
      {error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={!!busy} onClick={() => setModal(null)}>取消</button><button className={`primary-button ${modal === 'deleteBranch' || modal === 'abortMerge' ? 'danger-button' : ''}`} type="submit" disabled={!!busy || (modal === 'remote' && !remotes.length) || (modal === 'mergeInto' && !mergeTarget)}>{busy ? <><span className="spinner small" />{busy}</> : modal === 'open' ? '打开仓库' : modal === 'clone' ? '开始克隆' : modal === 'createBranch' ? '创建并切换' : modal === 'identity' ? '保存身份' : modal === 'deleteBranch' ? '确认删除' : modal === 'abortMerge' ? '中止合并' : modal === 'mergeInto' ? '合并已提交内容' : '执行操作'}</button></div>
    </form></section></div>}
    {conflict && <div className="modal-backdrop conflict-backdrop"><section className="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><div className="modal-header"><div><span className="eyebrow">RESOLVE CONFLICT</span><h2 id="conflict-title">{conflict.path}</h2></div><button className="icon-button" aria-label="关闭冲突编辑器" disabled={!!busy} onClick={() => setConflict(null)}><Icon name="close" /></button></div><p className="conflict-intro">对照两侧内容，编辑合并结果后保存并暂存。使用一侧内容会替换整个文件。</p>{conflict.truncated && <div className="inline-notice">内容已截断，手动编辑已禁用。请在外部编辑器中处理，或完整采用一侧。</div>}{conflict.binary && <div className="inline-notice">二进制冲突：可完整采用一侧，或关闭后使用外部工具处理。</div>}<div className="conflict-columns"><section><h3>{oursLabel}{conflict.ours === null && <span>文件已删除</span>}</h3><pre>{conflict.binary ? '(二进制内容)' : conflict.ours ?? '(此侧无文件)'}</pre><button className="secondary-button compact" disabled={!!busy} onClick={() => void resolveConflict('ours')}>{oursButton}</button></section><section><h3>合并结果 · 可编辑</h3><textarea aria-label="冲突合并结果" spellCheck={false} value={resolvedText} onChange={e => setResolvedText(e.target.value)} disabled={!!busy || conflict.binary || conflict.truncated} /></section><section><h3>{theirsLabel}{conflict.theirs === null && <span>文件已删除</span>}</h3><pre>{conflict.binary ? '(二进制内容)' : conflict.theirs ?? '(此侧无文件)'}</pre><button className="secondary-button compact" disabled={!!busy} onClick={() => void resolveConflict('theirs')}>{theirsButton}</button></section></div><details className="base-version"><summary>查看共同祖先 Base</summary><pre>{conflict.binary ? '(二进制内容)' : conflict.base ?? '(没有共同祖先版本)'}</pre></details>{error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}<div className="modal-actions"><button className="secondary-button" disabled={!!busy} onClick={() => setConflict(null)}>关闭</button><button className="primary-button" disabled={!!busy || conflict.binary || conflict.truncated} onClick={() => void resolveConflict('manual')}><Icon name="check" size={16} />保存合并结果并暂存</button></div></section></div>}
  </div>;
}
