import { useState, type FormEvent } from 'react';
import type { Branch, Commit, Failure, Repository, Requests } from '../shared/types';

export type RepositoryActionIntent =
  | { kind: 'rebase'; repository: Repository; target: string; targetCommit?: Commit }
  | { kind: 'revert'; repository: Repository; commit: Commit }
  | { kind: 'reset'; repository: Repository; commit: Commit }
  | { kind: 'rollback'; repository: Repository; paths: string[]; displayPaths: string[]; scope: 'worktree' | 'all'; unavailable?: string }
  | { kind: 'rebaseAction'; action: 'skip' | 'abort'; repository: Repository }
  | { kind: 'revertAction'; action: 'abort'; repository: Repository }
  | { kind: 'rebaseSavedAction'; action: 'restore-unstaged' | 'finish'; repository: Repository };
export type RepositoryActionRequest =
  | { operation: 'rebase'; payload: Requests['rebase'] }
  | { operation: 'revert'; payload: Requests['revert'] }
  | { operation: 'reset'; payload: Requests['reset'] }
  | { operation: 'rollback'; payload: Requests['rollback'] }
  | { operation: 'rebaseAction'; payload: Requests['rebaseAction'] }
  | { operation: 'revertAction'; payload: Requests['revertAction'] }
  | { operation: 'rebaseSavedAction'; payload: Requests['rebaseSavedAction'] };

export function RepositoryActionDialog({ intent, branches, busy, error, onClose, onExecute }: {
  intent: RepositoryActionIntent; branches: Branch[]; busy: boolean; error: Failure | null; onClose(): void; onExecute(request: RepositoryActionRequest): Promise<void>;
}) {
  const repository = intent.repository;
  const [branchSnapshot] = useState(() => branches.map(branch => ({ ...branch })));
  const [sourceBranch, setSourceBranch] = useState(repository.branch);
  const [target, setTarget] = useState(intent.kind === 'rebase' ? intent.target : '');
  const [preserveMerges, setPreserveMerges] = useState(false);
  const [autoSaveChanges, setAutoSaveChanges] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [mode, setMode] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const [discard, setDiscard] = useState(false);
  const [mainline, setMainline] = useState(1);
  const isHistory = intent.kind === 'rebase' || intent.kind === 'revert' || intent.kind === 'reset';
  const requiresClean = intent.kind === 'revert';
  const dirty = repository.entries.length > 0;
  const targetCommit = intent.kind === 'rebase' ? intent.targetCommit : undefined;
  const sourceSnapshot = branchSnapshot.find(branch => !branch.remote && branch.name === sourceBranch);
  const missingSource = !sourceSnapshot || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sourceSnapshot.hash);
  const invalid = (requiresClean && dirty) || (intent.kind === 'rebase' && ((dirty && !autoSaveChanges) || missingSource || (!targetCommit && (!target || target === sourceBranch)))) || (intent.kind === 'reset' && mode === 'hard' && !discard) || (intent.kind === 'rollback' && (!!intent.unavailable || !discard)) || (intent.kind === 'rebaseSavedAction' && (intent.action === 'finish' ? !recoveryConfirmed || repository.entries.some(entry => entry.conflict) || !!repository.operation || repository.mergeInProgress : dirty || !!repository.operation || repository.mergeInProgress));
  const title = intent.kind === 'rebase' ? targetCommit ? '将分支变基到指定提交' : sourceBranch === repository.branch ? '将当前分支变基到目标分支' : '将指定分支变基到目标分支'
    : intent.kind === 'revert' ? '反向提交 · Revert'
    : intent.kind === 'reset' ? '重置当前分支 · Reset'
    : intent.kind === 'rollback' ? intent.scope === 'worktree' ? '撤销未暂存修改' : '撤销暂存及工作区修改'
    : intent.kind === 'rebaseSavedAction' ? intent.action === 'finish' ? '结束改动恢复并保留备份' : '恢复为未暂存修改'
    : intent.kind === 'rebaseAction' ? intent.action === 'skip' ? '跳过当前变基提交' : '中止变基'
    : '中止反向提交';
  const button = intent.kind === 'rebase' ? '开始变基' : intent.kind === 'revert' ? '创建反向提交' : intent.kind === 'reset' ? '确认重置' : intent.kind === 'rollback' ? '确认撤销修改' : intent.kind === 'rebaseSavedAction' ? intent.action === 'finish' ? '确认结束恢复并保留备份' : '确认恢复为未暂存修改' : intent.action === 'skip' ? '确认跳过提交' : intent.kind === 'rebaseAction' ? '确认中止变基' : '确认中止反向提交';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || invalid) return;
    switch (intent.kind) {
      case 'rebase': return onExecute({ operation: 'rebase', payload: { ...(targetCommit ? { targetCommit: targetCommit.hash } : { branch: target }), sourceBranch, expectedSourceHead: sourceSnapshot!.hash, preserveMerges, expectedHead: repository.head, ...(dirty && autoSaveChanges ? { autoSaveChanges: true } : {}) } });
      case 'revert': return onExecute({ operation: 'revert', payload: { hash: intent.commit.hash, expectedHead: repository.head, ...(intent.commit.parents.length > 1 ? { mainline } : {}) } });
      case 'reset': return onExecute({ operation: 'reset', payload: { hash: intent.commit.hash, mode, expectedHead: repository.head, ...(mode === 'hard' ? { discard: true } : {}) } });
      case 'rollback': return onExecute({ operation: 'rollback', payload: { paths: intent.paths, scope: intent.scope, expectedHead: repository.head, discard: true } });
      case 'rebaseAction': return onExecute({ operation: 'rebaseAction', payload: { action: intent.action } });
      case 'revertAction': return onExecute({ operation: 'revertAction', payload: { action: intent.action } });
      case 'rebaseSavedAction': return onExecute({ operation: 'rebaseSavedAction', payload: { action: intent.action } });
    }
  };
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}><section className="modal history-action-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-action-title" onClick={event => event.stopPropagation()}>
    <div className="modal-header"><div><span className="eyebrow">REPOSITORY ACTION</span><h2 id="repository-action-title">{title}</h2></div><button className="icon-button" aria-label="关闭仓库操作对话框" disabled={busy} onClick={onClose}>×</button></div>
    <form onSubmit={event => void submit(event)}>
      <div className="action-repository"><strong>{repository.operation?.branch || repository.branch}</strong><small title={repository.root}>{repository.root}</small><code>HEAD {repository.head.slice(0, 12) || '尚无提交'}</code></div>
      {intent.kind === 'rebase' && <><label>要变基的本地分支<select autoFocus aria-label="要变基的分支" value={sourceBranch} onChange={event => { const next = event.target.value; setSourceBranch(next); if (next === target) setTarget(''); }} disabled={busy} required><option value="">请选择本地分支</option>{branchSnapshot.filter(branch => !branch.remote).map(branch => <option key={branch.name} value={branch.name}>{branch.name}{branch.name === repository.branch ? ' · 当前' : ''}</option>)}</select></label>{sourceSnapshot && <p className="form-help">源分支快照 <code>{sourceSnapshot.hash.slice(0, 12)}</code> · 执行时会核对这个提交。</p>}{targetCommit ? <div className="action-selected-commit" aria-label="变基目标提交"><code>{targetCommit.shortHash}</code><strong>{targetCommit.subject}</strong><small>{targetCommit.hash}</small></div> : <label>目标基底分支<select aria-label="变基目标分支" value={target} onChange={event => setTarget(event.target.value)} disabled={busy} required><option value="">请选择目标分支</option>{branchSnapshot.filter(branch => branch.remote || branch.name !== sourceBranch).map(branch => <option key={`${branch.remote ? 'remote' : 'local'}:${branch.name}`} value={branch.name}>{branch.name}{branch.remote ? ' · 远程' : ''}</option>)}</select></label>}<div className="history-action-explanation"><strong>{sourceBranch || '选择本地分支'} → {targetCommit ? targetCommit.shortHash : target || '目标分支'}</strong><p>将所选源分支独有的提交，依次重放到目标{targetCommit ? '提交' : '分支'}之上；需要重放时，提交 ID 会改变。源分支没有独有提交时，将直接前进到目标。</p><p>{dirty && autoSaveChanges ? sourceBranch === repository.branch ? `先保存 ${repository.branch} 的未提交改动，变基完成或中止后再恢复到这个分支。` : `先保存当前 ${repository.branch} 的未提交改动，再切换到 ${sourceBranch || '所选分支'} 变基；完成或中止后切回 ${repository.branch} 恢复。` : sourceBranch === repository.branch ? `当前项目保持在 ${sourceBranch}，并修改这个本地分支。` : `当前项目将从 ${repository.branch} 切换到 ${sourceBranch || '所选分支'}，并修改所选本地分支。`}目标提交所在的其他分支保持不变。</p><p>{dirty ? autoSaveChanges ? '当前工作区的未提交改动不会带到其他源分支。' : '有未提交改动也可尝试：在下方明确选择先自动保存，再执行变基。' : '当前工作区干净，可直接变基。'}</p></div>{dirty && <section className="auto-save-changes"><label className="action-checkbox"><input type="checkbox" aria-label="自动保存未提交改动后变基" checked={autoSaveChanges} onChange={event => setAutoSaveChanges(event.target.checked)} disabled={busy} /><span>自动保存未提交改动后变基<small>保存暂存、未暂存及未跟踪内容；忽略文件不保存。</small></span></label><p className="form-help">完成或中止变基后，尝试恢复这些改动并保留原暂存状态。恢复冲突时保留备份，等待你处理；不会自动提交。</p><p className="auto-save-status" role="status">当前有 {repository.entries.length} 个文件存在未提交改动。{autoSaveChanges ? '已选择先保存，可以继续尝试变基。' : '勾选上方选项即可继续，或先自行处理改动。'}</p></section>}{missingSource && <p className="action-danger-note" role="status">缺少所选本地分支的提交快照。请关闭对话框并刷新分支列表，再重新打开。</p>}<label className="action-checkbox"><input type="checkbox" aria-label="保留合并结构" checked={preserveMerges} onChange={event => setPreserveMerges(event.target.checked)} disabled={busy} /><span>保留合并结构（--rebase-merges）<small>尝试重建原有合并提交，可能需要再次解决合并冲突。</small></span></label></>}
      {(intent.kind === 'revert' || intent.kind === 'reset') && <div className="action-selected-commit"><code>{intent.commit.shortHash}</code><strong>{intent.commit.subject}</strong><small>{intent.commit.hash}</small></div>}
      {intent.kind === 'revert' && <><p className="confirmation-copy">确认后立即创建新的反向提交，撤销所选提交的改动，不删除已有历史。工作区需要干净；仅支持撤销当前分支历史中的提交。</p>{intent.commit.parents.length > 1 && <><label>合并提交的主线父提交<select aria-label="Revert 主线父提交" value={mainline} onChange={event => setMainline(Number(event.target.value))} disabled={busy}>{intent.commit.parents.map((parent, index) => <option key={parent} value={index + 1}>父提交 {index + 1} · {parent.slice(0, 12)}{index === 0 ? '（默认）' : ''}</option>)}</select></label><p className="form-help">把所选父提交作为保留的主线，反向应用“该父提交 → 合并提交”的差异。父提交 1 通常是执行合并时所在分支，请核对后再继续。</p></>}</>}
      {intent.kind === 'reset' && <><p className="confirmation-copy">将当前分支指向所选祖先提交。选择工作区与暂存区的处理方式：</p><div className="reset-modes" role="radiogroup" aria-label="Reset 模式">{([
        ['soft', 'Soft · 保留暂存', '只移动分支指针；保留暂存区和工作区，撤回的提交改动仍处于暂存状态。'],
        ['mixed', 'Mixed · 保留工作区', '移动分支指针并重置暂存区；保留工作区内容，撤回的改动变为未暂存。'],
        ['hard', 'Hard · 丢弃已跟踪修改', '分支指针、暂存区与已跟踪文件都恢复到所选提交。未提交的已跟踪修改会丢失。'],
      ] as const).map(([value, label, explanation]) => <label className={`reset-mode ${mode === value ? 'selected' : ''}`} key={value}><input type="radio" name="reset-mode" aria-label={label} value={value} checked={mode === value} disabled={busy} onChange={() => { setMode(value); setDiscard(false); }} /><span><strong>{label}</strong><small>{explanation}</small></span></label>)}</div>{mode === 'hard' && <><p className="action-danger-note">未跟踪及忽略内容会保留；如与恢复路径冲突，或存在子模块、符号链接或联接目录风险，将拒绝操作。请先处理冲突后再重试。</p><label className="action-checkbox"><input type="checkbox" aria-label="确认丢弃已跟踪的未提交修改" checked={discard} onChange={event => setDiscard(event.target.checked)} disabled={busy} /><span>我确认丢弃已跟踪的未提交修改<small>恢复引用只保留操作前的提交，不备份未提交内容。</small></span></label></>}</>}
      {intent.kind === 'rollback' && <><p className="confirmation-copy">{intent.scope === 'worktree' ? '用暂存区版本恢复以下文件，丢弃它们的未暂存修改；已暂存的内容保持不变。' : '用 HEAD 版本恢复以下文件，丢弃它们已暂存及未暂存的修改。'}此操作不删除未跟踪文件。</p><ul className="rollback-paths">{intent.displayPaths.map(file => <li key={file}><code>{file}</code></li>)}</ul>{intent.unavailable ? <p className="action-danger-note">{intent.unavailable}</p> : <label className="action-checkbox"><input type="checkbox" aria-label="确认丢弃所列文件的修改" checked={discard} onChange={event => setDiscard(event.target.checked)} disabled={busy} /><span>我确认丢弃上述修改<small>未提交内容不包含在提交恢复引用中。</small></span></label>}</>}
      {intent.kind === 'rebaseAction' && <p className="confirmation-copy">{intent.action === 'skip' ? '跳过正在重放的当前提交，丢弃这一步的冲突解决编辑，并继续重放后续提交。该提交的改动将不包含在变基结果中。' : '中止变基并恢复到变基前的分支与提交。这次变基期间的冲突解决编辑会丢失。'}{repository.operation?.commit && <code className="operation-current-commit">当前提交 {repository.operation.commit}</code>}</p>}
      {intent.kind === 'rebaseSavedAction' && <><p className="confirmation-copy">{intent.action === 'restore-unstaged' ? '把保存的改动恢复到工作区，不恢复原来的暂存状态。恢复后的已跟踪修改将保持未暂存；未跟踪文件仍保持未跟踪。备份会保留，出现冲突后请检查并解决。' : '确认你已经检查、解决并处理保存改动的恢复结果。结束恢复后可继续普通提交和其他操作；不会自动提交，也不会删除保存的备份。'}</p>{repository.rebaseSavedChanges && <div className="saved-change-reference"><span>保存的改动备份</span><code>{repository.rebaseSavedChanges.ref}</code><small>{repository.rebaseSavedChanges.message}</small></div>}{intent.action === 'finish' && <label className="action-checkbox"><input type="checkbox" aria-label="已检查并处理恢复的改动" checked={recoveryConfirmed} onChange={event => setRecoveryConfirmed(event.target.checked)} disabled={busy || repository.entries.some(entry => entry.conflict)} /><span>我已检查并处理恢复的改动<small>如仍有未合并冲突，请先解决并暂存，再结束恢复。</small></span></label>}</>}
      {intent.kind === 'revertAction' && <p className="confirmation-copy">中止正在进行的反向提交并恢复操作前的状态。这次操作期间的冲突解决编辑会丢失。</p>}
      {requiresClean && dirty && <p className="action-danger-note" role="status">当前有 {repository.entries.length} 个文件存在未提交改动。请关闭对话框并先处理这些改动。</p>}
      {isHistory && <p className="form-help">{intent.kind === 'revert' ? '将创建普通新提交，可正常推送。' : `${intent.kind === 'rebase' ? '操作前的源分支' : '操作前的'}提交会保存为本地恢复引用。修改已推送的历史后，普通 Push 可能被远程拒绝。`}执行时会核对打开此对话框时的 HEAD，防止覆盖外部切换。</p>}
      {error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className={`primary-button ${intent.kind === 'rollback' || (intent.kind === 'reset' && mode === 'hard') || intent.kind.endsWith('Action') ? 'danger-button' : ''}`} disabled={busy || invalid}>{busy ? '正在执行…' : button}</button></div>
    </form>
  </section></div>;
}
