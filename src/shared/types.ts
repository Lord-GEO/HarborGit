export type Area = 'worktree' | 'index' | 'commit';
export type AppTheme = 'dark' | 'light';
export interface AppAppearance { theme: AppTheme; saved: boolean; }
export interface FileChange { path: string; originalPath?: string; index: string; worktree: string; conflict: boolean; }
export interface MergeWorkspace { sourceRoot: string; sourceBranch: string; targetBranch: string; }
export interface RepositoryOperation { kind: 'rebase' | 'revert'; branch?: string; onto?: string; commit?: string; step?: number; total?: number; }
export interface RebaseSavedChanges { ref: string; originalBranch: string; sourceBranch: string; status: 'saving' | 'saved' | 'restore-pending' | 'restore-conflicts' | 'restored'; message: string; }
export interface Repository { sessionId?: string; mergeWorkspace?: MergeWorkspace; root: string; branch: string; head: string; unborn: boolean; detached: boolean; upstream: string; ahead: number; behind: number; entries: FileChange[]; mergeInProgress: boolean; operation?: RepositoryOperation; historyBackup?: string; rebaseSavedChanges?: RebaseSavedChanges; userName: string; userEmail: string; }
export interface MergeIntoResult { repository: Repository; mergeRepository: Repository | null; status: 'merged' | 'attention'; message: string; }
export interface Commit { hash: string; shortHash: string; parents: string[]; author: string; email: string; date: string; subject: string; body: string; refs: string; }
export interface StagedSnapshot { tree: string; files: CommitFile[]; diff: string; truncated: boolean; }
export interface AiSuggestion { message: string; tree: string; fileCount: number; truncated: boolean; stale: boolean; }
export interface AiSettingsInput { baseUrl: string; model: string; protocol: 'responses' | 'chat-completions'; language: 'zh' | 'en'; style: 'conventional' | 'simple'; apiKey?: string; clearApiKey?: boolean; }
export interface AiSettings extends Omit<AiSettingsInput, 'apiKey' | 'clearApiKey'> { hasApiKey: boolean; keyStorage: 'encrypted' | 'memory' | 'none'; }
export interface CommitFile { path: string; oldPath?: string; status: string; }
export interface Diff { text: string; binary: boolean; truncated: boolean; }
export interface Branch { name: string; current: boolean; remote: boolean; upstream: string; subject: string; hash: string; }
export interface Remote { name: string; fetch: string; push: string; }
export interface GitTag { name: string; objectId: string; kind: 'annotated' | 'lightweight'; target: string; targetType: string; date: string; }
export interface Conflict { path: string; base: string | null; ours: string | null; theirs: string | null; worktree: string; binary: boolean; truncated: boolean; }
export interface Activity { id: string; sessionId?: string; command: string; kind: 'start' | 'progress' | 'finish'; text: string; time: string; exitCode?: number; }
export interface Failure { message: string; code?: number | string; command?: string; stderr?: string; stdout?: string; cancelled?: boolean; }
export interface TerminalInfo { id: string; sessionId: string; terminalKey: string; pid: number; shell: string; cwd: string; running: boolean; }
export interface TerminalSnapshot { info: TerminalInfo; output: string; sequence: number; }
export type TerminalEvent = { id: string; sessionId: string; terminalKey: string } & ({ kind: 'data'; data: string; sequence: number } | { kind: 'exit'; exitCode: number });
export type Result<T> = { ok: true; data: T } | { ok: false; error: Failure };
export type UpdateAction = 'check' | 'download' | 'cancel' | 'install' | 'open-release';
export interface UpdateProgress { percent: number; transferred: number; total: number; bytesPerSecond: number; }
export interface UpdateRelease { version: string; notes?: string; date?: string; }
export interface UpdateState {
  currentVersion: string; mode: 'installer' | 'manual' | 'development';
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  autoCheck: boolean; message: string; checkedAt?: string; release?: UpdateRelease; progress?: UpdateProgress; error?: string;
}
export interface Requests {
  open: { path: string }; clone: { url: string; destination: string }; refresh: Record<string, never>;
  diff: { path: string; area: Area; commit?: string; oldPath?: string }; stage: { paths: string[] }; unstage: { paths: string[] }; commit: { message: string };
  history: { skip?: number; limit?: number; scope?: 'all' | 'current' }; commitFiles: { hash: string }; branches: Record<string, never>;
  stagedSnapshot: Record<string, never>; stagedTree: Record<string, never>; generateCommit: Record<string, never>;
  createBranch: { name: string; startPoint?: string }; checkout: { name: string }; deleteBranch: { name: string };
  tags: Record<string, never>;
  createTag: { name: string; targetCommit: string; kind: 'annotated' | 'lightweight'; message?: string };
  pushTag: { name: string; remote: string; expectedObjectId: string };
  remotes: Record<string, never>; remote: { action: 'fetch' | 'pull' | 'push'; remote: string; branch?: string };
  saveRemote: { name: string; url: string; pushUrl?: string; create: boolean }; removeRemote: { name: string };
  merge: { branch: string }; mergeInto: { target: string }; finishMergeWorkspace: Record<string, never>; conflict: { path: string }; resolve: { path: string; choice: 'ours' | 'theirs' | 'manual'; content?: string };
  abortMerge: Record<string, never>; identity: { name: string; email: string };
  rebase: { branch?: string; targetCommit?: string; sourceBranch?: string; expectedSourceHead?: string; preserveMerges?: boolean; autoSaveChanges?: boolean; expectedHead: string };
  rebaseAction: { action: 'continue' | 'skip' | 'abort' };
  rebaseSavedAction: { action: 'restore' | 'restore-unstaged' | 'finish' };
  revert: { hash: string; mainline?: number; expectedHead: string };
  revertAction: { action: 'continue' | 'abort' };
  reset: { hash: string; mode: 'soft' | 'mixed' | 'hard'; expectedHead: string; discard?: boolean };
  rollback: { paths: string[]; scope: 'worktree' | 'all'; expectedHead: string; discard: true };
}
export interface Responses {
  open: Repository; clone: Repository; refresh: Repository; diff: Diff; stage: Repository; unstage: Repository; commit: Repository;
  history: Commit[]; commitFiles: CommitFile[]; branches: Branch[]; createBranch: Repository; checkout: Repository; deleteBranch: Repository;
  stagedSnapshot: StagedSnapshot; stagedTree: string; generateCommit: AiSuggestion;
  tags: GitTag[]; createTag: Repository; pushTag: Repository;
  remotes: Remote[]; remote: Repository; merge: Repository; mergeInto: MergeIntoResult; finishMergeWorkspace: { sourceRoot: string }; conflict: Conflict; resolve: Repository; abortMerge: Repository; identity: Repository;
  saveRemote: Repository; removeRemote: Repository;
  rebase: Repository; rebaseAction: Repository; rebaseSavedAction: Repository; revert: Repository; revertAction: Repository; reset: Repository; rollback: Repository;
}
export interface HarborAPI {
  platform: string;
  appearance(): Promise<AppAppearance>;
  setTheme(theme: AppTheme): Promise<Result<AppAppearance>>;
  request<K extends keyof Requests>(operation: K, payload: Requests[K], sessionId?: string): Promise<Result<Responses[K]>>;
  closeRepository(sessionId: string): Promise<Result<boolean>>;
  terminalOpen(sessionId: string, cols: number, rows: number, terminalKey?: string): Promise<Result<TerminalSnapshot>>;
  terminalClose(sessionId: string, terminalKey: string): Promise<Result<boolean>>;
  terminalStop(sessionId: string, terminalId: string): Promise<Result<boolean>>;
  terminalInput(sessionId: string, terminalId: string, data: string): void;
  terminalResize(sessionId: string, terminalId: string, cols: number, rows: number): void;
  terminalAck(sessionId: string, terminalId: string, sequence: number): void;
  terminalClipboard(sessionId: string, terminalId: string, action: 'copy' | 'paste', text?: string): Promise<Result<string>>;
  onTerminal(listener: (event: TerminalEvent) => void): () => void;
  pickDirectory(): Promise<string | null>;
  onActivity(listener: (event: Activity) => void): () => void;
  cancel(id: string): Promise<boolean>;
  recent(): Promise<string[]>;
  version(): Promise<string>;
  aiSettings(): Promise<Result<AiSettings>>;
  saveAiSettings(settings: AiSettingsInput): Promise<Result<AiSettings>>;
  updateStatus(): Promise<UpdateState>;
  updateAction(action: UpdateAction): Promise<Result<UpdateState>>;
  saveUpdateAutoCheck(enabled: boolean): Promise<Result<UpdateState>>;
  onUpdate(listener: (state: UpdateState) => void): () => void;
}
declare global { interface Window { harbor: HarborAPI; } }
