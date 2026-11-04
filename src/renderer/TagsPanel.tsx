import { useState, type FormEvent } from 'react';
import type { Failure, GitTag, Remote, Requests } from '../shared/types';

export type TagIntent = { kind: 'create'; target: string; subject: string } | { kind: 'push'; tag: GitTag };

export function TagsPanel({ tags, busy, blocked, canCreate, onCreate, onPush, onHistory }: {
  tags: GitTag[]; busy: boolean; blocked: boolean; canCreate: boolean;
  onCreate(): void; onPush(tag: GitTag): void; onHistory(): void;
}) {
  const [filter, setFilter] = useState('');
  const visible = tags.filter(tag => tag.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section className="tags-view" aria-label="标签列表">
    <div className="tags-heading"><div><h2>本地标签</h2></div>
      <button className="primary-button compact" disabled={busy || blocked || !canCreate} onClick={onCreate}>＋ 新建标签</button>
    </div>
    <div className="tags-tools"><input aria-label="筛选标签" placeholder="搜索标签名称…" value={filter} onChange={event => setFilter(event.target.value)} /><span>{visible.length} / {tags.length} 个本地标签</span><button className="text-button" disabled={busy} onClick={onHistory}>在历史中选择提交</button></div>
    <div className="tags-list">{visible.map(tag => <article className="tag-row" key={tag.name} aria-label={`标签 ${tag.name}`}>
      <div className="tag-symbol" aria-hidden="true">◇</div><div className="tag-info"><strong>{tag.name}<span className="tag">{tag.kind === 'annotated' ? '附注标签' : '轻量标签'}</span></strong>
        <code title={tag.target}>{tag.targetType === 'commit' ? '提交' : '对象'} {tag.target.slice(0, 12)}</code>
        <small>{tag.kind === 'annotated' ? '标记于 ' : '提交于 '}{tag.date ? new Date(tag.date).toLocaleString('zh-CN') : '无日期'} · 远程状态未查询</small>
      </div><button className="secondary-button compact" aria-label={`推送标签 ${tag.name}`} disabled={busy || blocked} onClick={() => onPush(tag)}>推送标签…</button>
    </article>)}</div>
    {!visible.length && <div className="tags-empty"><h3>{tags.length ? '没有匹配的标签' : '还没有本地标签'}</h3><p>{tags.length ? '试试其他名称。' : '给当前提交创建标签，或从提交历史中选择更早的提交。'}</p></div>}
  </section>;
}

export function TagDialog({ intent, remotes, busy, error, onClose, onCreate, onPush, onManageRemotes }: {
  intent: TagIntent; remotes: Remote[]; busy: boolean; error: Failure | null;
  onClose(): void; onCreate(input: Requests['createTag']): Promise<unknown>; onPush(input: Requests['pushTag']): Promise<unknown>; onManageRemotes(): void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'annotated' | 'lightweight'>('annotated');
  const [message, setMessage] = useState('');
  const [remote, setRemote] = useState(remotes.find(item => item.name === 'origin')?.name || remotes[0]?.name || '');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (intent.kind === 'create') await onCreate({ name: name.trim(), targetCommit: intent.target, kind, ...(kind === 'annotated' ? { message } : {}) });
    else await onPush({ name: intent.tag.name, remote, expectedObjectId: intent.tag.objectId });
  };
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); } }}>
    <section className="modal tag-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-dialog-title" onClick={event => event.stopPropagation()}>
      <div className="modal-header"><div><span className="eyebrow">REPOSITORY TAGS</span><h2 id="tag-dialog-title">{intent.kind === 'create' ? '创建标签' : '推送标签'}</h2></div><button className="icon-button" aria-label="关闭标签对话框" disabled={busy} onClick={onClose}>×</button></div>
      <form onSubmit={event => void submit(event)}>
        {intent.kind === 'create' ? <>
          <div className="tag-target"><span>目标提交</span><strong>{intent.subject}</strong><code>{intent.target}</code></div>
          <label>标签名称<input autoFocus aria-label="标签名称" placeholder="例如 v1.7.0" value={name} onChange={event => setName(event.target.value)} disabled={busy} required maxLength={1024} spellCheck={false} /></label>
          <label>标签类型<select aria-label="标签类型" value={kind} onChange={event => setKind(event.target.value as typeof kind)} disabled={busy}><option value="annotated">附注标签 · 记录说明和创建者</option><option value="lightweight">轻量标签 · 仅标记提交</option></select></label>
          {kind === 'annotated' && <label>标签说明<textarea aria-label="标签说明" rows={3} value={message} onChange={event => setMessage(event.target.value)} placeholder="此次版本包含哪些更新？" required maxLength={65536} disabled={busy} /></label>}
          <p className="form-help">标签指向上方已提交的版本，未提交的修改不会包含在内。创建后可在标签列表中推送。</p>
        </> : <>
          <div className="tag-target"><span>{intent.tag.kind === 'annotated' ? '附注标签' : '轻量标签'}</span><strong>{intent.tag.name}</strong><code>{intent.tag.target}</code></div>
          <label>推送到远程<select autoFocus aria-label="标签推送远程" required value={remote} disabled={busy || !remotes.length} onChange={event => setRemote(event.target.value)}>{remotes.length ? remotes.map(item => <option key={item.name} value={item.name}>{item.name}</option>) : <option value="">尚未配置远程仓库</option>}</select></label>
          {remote && <div className="remote-address">{remotes.find(item => item.name === remote)?.push}</div>}
          <button type="button" className="text-button remote-config-link" disabled={busy} onClick={onManageRemotes}>管理远程仓库地址</button>
          <p className="form-help">仅推送此标签及其引用的提交。同名远程标签如指向其他对象，推送会被拒绝。耗时任务可在底部取消。</p>
        </>}
        {error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}
        <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={busy || (intent.kind === 'create' ? !name.trim() || (kind === 'annotated' && !message.trim()) : !remote)}>{busy ? '处理中…' : intent.kind === 'create' ? '创建标签' : '推送标签'}</button></div>
      </form>
    </section>
  </div>;
}
