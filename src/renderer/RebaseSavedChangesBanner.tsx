import type { Repository } from '../shared/types';

export function RebaseSavedChangesBanner({ repository, busy, onRestore, onConfirm }: {
  repository: Repository; busy: boolean; onRestore(): void; onConfirm(action: 'restore-unstaged' | 'finish'): void;
}) {
  const saved = repository.rebaseSavedChanges;
  if (!saved) return null;
  const activeOperation = !!repository.operation || repository.mergeInProgress;
  const conflicts = repository.entries.some(entry => entry.conflict);
  const dirty = repository.entries.length > 0;
  const restored = saved.status === 'restored';
  const canOfferRecovery = !activeOperation && ['saved', 'restore-pending', 'restore-conflicts'].includes(saved.status);
  const canApply = canOfferRecovery && !busy && !dirty && !conflicts;
  return <section className={`saved-changes-banner ${restored ? 'restored' : saved.status === 'restore-conflicts' ? 'has-conflicts' : ''}`} aria-label="变基未提交改动备份">
    <div className="saved-changes-heading"><strong>{restored ? '未提交改动恢复已结束' : saved.status === 'saving' ? '正在保存未提交改动' : saved.status === 'restore-conflicts' ? '保存的改动恢复时出现冲突' : saved.status === 'restore-pending' ? '保存的未提交改动等待恢复' : '未提交改动已安全保存'}</strong><span>{saved.originalBranch}{saved.sourceBranch !== saved.originalBranch ? ` · 变基分支 ${saved.sourceBranch}` : ''}</span></div>
    <p>{saved.message || (restored ? '保存的改动已恢复，备份仍保留，不影响继续工作。' : activeOperation ? '变基期间，原工作区改动保存在下面的专用引用中。完成或中止后将尝试恢复。' : '请检查保存的改动并完成恢复；备份会保留。')}</p>
    <code>{saved.ref}</code>
    {!restored && saved.status !== 'saving' && <small>包含保存的暂存、未暂存和未跟踪内容；忽略文件未保存。备份不会自动删除。</small>}
    {canOfferRecovery && <><div className="saved-changes-controls"><button className="secondary-button compact" disabled={!canApply} onClick={onRestore}>恢复保存的改动</button><button className="secondary-button compact" disabled={!canApply} onClick={() => onConfirm('restore-unstaged')}>恢复为未暂存修改</button><button className="primary-button compact" disabled={busy || conflicts} onClick={() => onConfirm('finish')}>结束恢复并保留备份</button></div>{dirty && <small className="saved-restore-note">当前已有改动或冲突，已禁止重复应用备份。请检查恢复结果，解决并暂存冲突，再结束恢复；不会自动提交。</small>}</>}
  </section>;
}
