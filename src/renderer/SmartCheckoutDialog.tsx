import type { CheckoutPrompt, Failure } from '../shared/types';

export function SmartCheckoutDialog({ prompt, busy, error, onClose, onSubmit }: {
  prompt: CheckoutPrompt; busy: boolean; error: Failure | null; onClose(): void; onSubmit(): void;
}) {
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
  }}><section className="modal history-action-dialog" role="dialog" aria-modal="true" aria-labelledby="smart-checkout-title" onClick={event => event.stopPropagation()}>
    <div className="modal-header"><h2 id="smart-checkout-title">智能签出</h2><button className="icon-button" aria-label="关闭智能签出" disabled={busy} onClick={onClose}>×</button></div>
    <div className="action-repository"><strong>{prompt.originalBranch} → {prompt.targetBranch}</strong><code>目标提交 {prompt.expectedTargetHead.slice(0, 12)}</code></div>
    <p className="confirmation-copy">普通签出会覆盖本地改动。智能签出会先保存以下全部改动，再切换到 {prompt.targetBranch}，并尝试把改动及暂存状态恢复到目标分支。</p>
    <ul className="rollback-paths" aria-label="智能签出保存文件">{prompt.paths.map(file => <li key={file}><code>{file}</code></li>)}</ul>
    <p className="form-help">包含暂存、未暂存和未跟踪文件；忽略文件不保存。恢复冲突时保留备份并等待处理，不会自动提交。</p>
    {error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}
    <div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy} onClick={onSubmit}>{busy ? '正在智能签出…' : '智能签出'}</button></div>
  </section></div>;
}
