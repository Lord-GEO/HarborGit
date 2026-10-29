import { randomUUID } from 'node:crypto';
import { GitError, GitService, type GitOptions } from './git-service';
import type { Activity, Repository, Requests, Responses, MergeIntoResult } from '../shared/types';

/** Each tab has an explicit service and queue. There is no mutable global cwd. */
export class Workspaces {
  private services = new Map<string, GitService>();
  constructor(private options: Omit<GitOptions, 'onActivity'> & { onActivity?: (event: Activity) => void } = {}) {}
  private create(id: string) {
    const service = new GitService({ ...this.options, onActivity: event => this.options.onActivity?.({ ...event, sessionId: id }) });
    this.services.set(id, service); return service;
  }
  private bind(id: string, repository: Repository) { return { ...repository, sessionId: id }; }
  async request<K extends keyof Requests>(operation: K, payload: Requests[K], sessionId?: string): Promise<Responses[K]> {
    const id = sessionId ?? randomUUID();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new GitError({ message: '项目标签标识无效' });
    const opening = operation === 'open' || operation === 'clone';
    let service = this.services.get(id);
    if (opening && service) throw new GitError({ message: '请在新的项目标签中打开仓库' });
    if (!service && !opening) throw new GitError({ message: '项目已关闭，请重新打开' });
    service ??= this.create(id);
    let data: Responses[K];
    try { data = await service.request(operation, payload); }
    catch (e) { if (opening) this.services.delete(id); throw e; }
    if (opening) {
      const repo = data as Repository;
      const duplicate = [...this.services].find(([otherId, other]) => otherId !== id && other.repositoryRoot.toLowerCase() === repo.root.toLowerCase());
      if (duplicate) {
        this.services.delete(id);
        return this.bind(duplicate[0], await duplicate[1].request('refresh', {})) as Responses[K];
      }
    }
    if (operation === 'mergeInto') {
      const merge = data as MergeIntoResult;
      merge.repository = this.bind(id, merge.repository);
      if (merge.mergeRepository) {
        const recoveryId = randomUUID(), recovery = this.create(recoveryId);
        merge.mergeRepository = this.bind(recoveryId, await recovery.request('open', { path: merge.mergeRepository.root }));
      }
    } else if (data && typeof data === 'object' && 'root' in data) return this.bind(id, data as Repository) as Responses[K];
    return data;
  }
  close(id: string): boolean {
    const service = this.services.get(id);
    if (!service) return true;
    if (service.pendingCount) throw new GitError({ message: '该项目仍有任务运行，请完成或取消后再关闭标签' });
    this.services.delete(id); return true;
  }
  cancel(id: string) { for (const service of this.services.values()) if (service.cancel(id)) return true; return false; }
  cancelAll() { for (const service of this.services.values()) service.cancelAll(); }
}
