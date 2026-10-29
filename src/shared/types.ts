export type Area = 'worktree' | 'index' | 'commit';
export interface FileChange { path: string; originalPath?: string; index: string; worktree: string; conflict: boolean; }
export interface MergeWorkspace { sourceRoot: string; sourceBranch: string; targetBranch: string; }
export interface Repository { sessionId?: string; mergeWorkspace?: MergeWorkspace; root: string; branch: string; head: string; unborn: boolean; detached: boolean; upstream: string; ahead: number; behind: number; entries: FileChange[]; mergeInProgress: boolean; userName: string; userEmail: string; }
export interface MergeIntoResult { repository: Repository; mergeRepository: Repository | null; status: 'merged' | 'attention'; message: string; }
export interface Commit { hash: string; shortHash: string; parents: string[]; author: string; email: string; date: string; subject: string; body: string; refs: string; }
export interface CommitFile { path: string; oldPath?: string; status: string; }
export interface Diff { text: string; binary: boolean; truncated: boolean; }
export interface Branch { name: string; current: boolean; remote: boolean; upstream: string; subject: string; hash: string; }
export interface Remote { name: string; fetch: string; push: string; }
export interface Conflict { path: string; base: string | null; ours: string | null; theirs: string | null; worktree: string; binary: boolean; truncated: boolean; }
export interface Activity { id: string; sessionId?: string; command: string; kind: 'start' | 'progress' | 'finish'; text: string; time: string; exitCode?: number; }
export interface Failure { message: string; code?: number | string; command?: string; stderr?: string; stdout?: string; cancelled?: boolean; }
export type Result<T> = { ok: true; data: T } | { ok: false; error: Failure };
export interface Requests {
  open: { path: string }; clone: { url: string; destination: string }; refresh: Record<string, never>;
  diff: { path: string; area: Area; commit?: string; oldPath?: string }; stage: { paths: string[] }; unstage: { paths: string[] }; commit: { message: string };
  history: { skip?: number; limit?: number }; commitFiles: { hash: string }; branches: Record<string, never>;
  createBranch: { name: string; startPoint?: string }; checkout: { name: string }; deleteBranch: { name: string };
  remotes: Record<string, never>; remote: { action: 'fetch' | 'pull' | 'push'; remote: string; branch?: string };
  merge: { branch: string }; mergeInto: { target: string }; finishMergeWorkspace: Record<string, never>; conflict: { path: string }; resolve: { path: string; choice: 'ours' | 'theirs' | 'manual'; content?: string };
  abortMerge: Record<string, never>; identity: { name: string; email: string };
}
export interface Responses {
  open: Repository; clone: Repository; refresh: Repository; diff: Diff; stage: Repository; unstage: Repository; commit: Repository;
  history: Commit[]; commitFiles: CommitFile[]; branches: Branch[]; createBranch: Repository; checkout: Repository; deleteBranch: Repository;
  remotes: Remote[]; remote: Repository; merge: Repository; mergeInto: MergeIntoResult; finishMergeWorkspace: { sourceRoot: string }; conflict: Conflict; resolve: Repository; abortMerge: Repository; identity: Repository;
}
export interface HarborAPI {
  request<K extends keyof Requests>(operation: K, payload: Requests[K], sessionId?: string): Promise<Result<Responses[K]>>;
  closeRepository(sessionId: string): Promise<Result<boolean>>;
  pickDirectory(): Promise<string | null>;
  onActivity(listener: (event: Activity) => void): () => void;
  cancel(id: string): Promise<boolean>;
  recent(): Promise<string[]>;
  version(): Promise<string>;
}
declare global { interface Window { harbor: HarborAPI; } }
