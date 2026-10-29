import { useState, type FormEvent } from 'react';
import type { Failure, Remote, Repository, Requests } from '../shared/types';

interface Props {
  remotes: Remote[];
  busy: boolean;
  error: Failure | null;
  onSave: (input: Requests['saveRemote']) => Promise<Repository | undefined>;
  onRemove: (name: string) => Promise<Repository | undefined>;
  onClearError: () => void;
  onClose: () => void;
}

export function RemoteSettingsDialog({ remotes, busy, error, onSave, onRemove, onClearError, onClose }: Props) {
  const [editing, setEditing] = useState<Remote | null | undefined>(remotes.length ? undefined : null);
  const [removing, setRemoving] = useState<Remote | null>(null);
  const [name, setName] = useState('origin');
  const [url, setUrl] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  const edit = (remote: Remote | null) => {
    onClearError(); setRemoving(null); setEditing(remote);
    setName(remote?.name || (remotes.some(r => r.name === 'origin') ? '' : 'origin'));
    setUrl(remote?.fetch || ''); setPushUrl(remote && remote.push !== remote.fetch ? remote.push : '');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSave({ name: name.trim(), url: url.trim(), pushUrl: pushUrl.trim(), create: editing === null })) setEditing(undefined);
  };
  const remove = async () => { if (removing && await onRemove(removing.name)) setRemoving(null); };

  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section className="modal remote-settings-modal" role="dialog" aria-modal="true" aria-labelledby="remote-settings-title" onClick={e => e.stopPropagation()}>
      <div className="modal-header"><div><span className="eyebrow">REPOSITORY REMOTES</span><h2 id="remote-settings-title">远程仓库设置</h2></div><button type="button" className="icon-button" aria-label="关闭远程仓库设置" disabled={busy} onClick={onClose}>×</button></div>
      {removing ? <>
        <p className="confirmation-copy">删除远程配置 <strong>{removing.name}</strong>？这会移除本地的远程跟踪引用及关联的上游设置，保留本地分支、文件和服务器上的仓库。</p>
        <div className="remote-address">{removing.fetch}</div>
      </> : editing !== undefined ? <form id="remote-settings-form" onSubmit={e => void save(e)}>
        <label>远程名称<input autoFocus={!editing} aria-label="远程配置名称" placeholder="origin" value={name} onChange={e => setName(e.target.value)} required disabled={busy || !!editing} /></label>
        <label>仓库地址<input autoFocus={!!editing} aria-label="远程仓库地址" placeholder="https://github.com/owner/repo.git 或 git@github.com:owner/repo.git" value={url} onChange={e => setUrl(e.target.value)} required disabled={busy} spellCheck={false} /></label>
        <label>独立推送地址（可选）<input aria-label="远程推送地址" placeholder="留空时使用仓库地址" value={pushUrl} onChange={e => setPushUrl(e.target.value)} disabled={busy} spellCheck={false} /></label>
        <p className="form-help">支持 HTTPS、SSH 和本地仓库路径。保存后可使用 Fetch、Pull 或 Push；保存地址无需登录。</p>
      </form> : <>
        <div className="remote-settings-list">{remotes.map(remote => <div className="remote-settings-row" key={remote.name}>
          <div><strong>{remote.name}</strong><code>{remote.fetch}</code>{remote.push !== remote.fetch && <small>推送：{remote.push}</small>}</div>
          <div className="inline-actions"><button type="button" className="secondary-button compact" disabled={busy} onClick={() => edit(remote)} aria-label={`编辑远程 ${remote.name}`}>编辑</button><button type="button" className="text-button danger-text" disabled={busy} onClick={() => { onClearError(); setRemoving(remote); }} aria-label={`删除远程 ${remote.name}`}>删除</button></div>
        </div>)}{!remotes.length && <p className="form-help">尚未配置远程仓库，添加地址后即可同步。</p>}</div>
        <button type="button" className="secondary-button compact add-remote" disabled={busy} onClick={() => edit(null)}>＋ 添加远程仓库</button>
      </>}
      <p className="form-help">HTTPS 首次访问可能打开系统 Git Credential Manager 登录窗口或浏览器，请完成授权。SSH 使用本机密钥配置。</p>
      {error && <div className="modal-error" role="alert"><strong>{error.message}</strong>{error.stderr && <pre>{error.stderr}</pre>}</div>}
      <div className="modal-actions">
        {removing ? <><button type="button" className="secondary-button" disabled={busy} onClick={() => { onClearError(); setRemoving(null); }}>取消删除</button><button type="button" className="primary-button danger-button" disabled={busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除远程'}</button></> : editing !== undefined ? <><button type="button" className="secondary-button" disabled={busy} onClick={() => { onClearError(); setEditing(undefined); }}>返回列表</button><button type="submit" form="remote-settings-form" className="primary-button" disabled={busy || !name.trim() || !url.trim()}>{busy ? '正在保存…' : '保存远程仓库'}</button></> : <button type="button" className="primary-button" disabled={busy} onClick={onClose}>完成</button>}
      </div>
    </section>
  </div>;
}
