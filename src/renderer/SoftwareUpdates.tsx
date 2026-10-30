import { useEffect, useState } from 'react';
import type { UpdateAction, UpdateState } from '../shared/types';

const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
export function SoftwareUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const api = window.harbor; if (!api) return;
    let live = true;
    const unsubscribe = api.onUpdate(value => { if (live) setState(value); });
    void api.updateStatus().then(value => { if (live) setState(value); }).catch(() => { if (live) setError('无法读取更新状态'); });
    return () => { live = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !confirming) setOpen(false); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [open, confirming]);
  const act = async (action: UpdateAction) => {
    setError(''); if (action === 'install') setConfirming(true);
    try { const result = await window.harbor.updateAction(action); if (!result.ok) setError(result.error.message); }
    catch { setError('更新服务暂时不可用，请重试'); }
    finally { if (action === 'install') setConfirming(false); }
  };
  const saveAuto = async (enabled: boolean) => {
    const previous = state?.autoCheck ?? true;
    setState(value => value ? { ...value, autoCheck: enabled } : value);
    setSaving(true); setError('');
    try { const result = await window.harbor.saveUpdateAutoCheck(enabled); if (!result.ok) { setError(result.error.message); setState(value => value ? { ...value, autoCheck: previous } : value); } }
    catch { setError('无法保存更新设置'); setState(value => value ? { ...value, autoCheck: previous } : value); }
    finally { setSaving(false); }
  };
  const phase = state?.phase;
  const hasUpdate = phase === 'available' || phase === 'downloaded';
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing' || confirming;
  return <>
    <button className={`theme-toggle software-update-button ${hasUpdate ? 'has-update' : ''}`} aria-label="软件更新" onClick={() => setOpen(true)}>{hasUpdate ? '● 有新版本' : phase === 'downloading' ? `↓ ${Math.floor(state?.progress?.percent || 0)}%` : '软件更新'}</button>
    {hasUpdate && !open && <button className="update-notice" onClick={() => setOpen(true)}>{phase === 'downloaded' ? '更新已下载，查看安装' : `HarborGit ${state?.release?.version} 可更新`} <span>→</span></button>}
    {open && <div className="modal-backdrop"><section className="modal software-update-modal" role="dialog" aria-modal="true" aria-labelledby="software-update-title">
      <div className="modal-header"><div><span className="eyebrow">HARBORGIT</span><h2 id="software-update-title">软件更新</h2></div><button className="icon-button" aria-label="关闭软件更新" disabled={confirming || phase === 'installing'} onClick={() => setOpen(false)}>×</button></div>
      <p className="update-version">当前版本 <strong>{state?.currentVersion || '读取中…'}</strong>{state?.release && <span>→ <strong>{state.release.version}</strong></span>}</p>
      <p className="update-source">更新来源：GitHub · Lord-GEO / HarborGit · 正式版</p>
      <div className="update-status" role="status">{busy && <span className="spinner small" />}<span>{state?.message || '正在读取更新状态…'}</span></div>
      {phase === 'downloading' && state?.progress && <div className="update-download">
        <progress aria-label="更新下载进度" value={state.progress.percent} max="100" />
        <div><span>{state.progress.percent.toFixed(1)}% · {bytes(state.progress.transferred)}{state.progress.total > 0 ? ` / ${bytes(state.progress.total)}` : ''}</span><span>{bytes(state.progress.bytesPerSecond)}/s</span></div>
        <p className="form-help">关闭此窗口后继续下载；下载完成后由你选择安装。</p>
      </div>}
      {state?.release?.notes && <details className="update-release-notes" open><summary>版本说明{state.release.date ? ` · ${new Date(state.release.date).toLocaleDateString('zh-CN')}` : ''}</summary><pre>{state.release.notes}</pre></details>}
      {state?.mode === 'installer' && <label className="checkbox-label"><input type="checkbox" checked={state.autoCheck} disabled={saving} onChange={event => void saveAuto(event.target.checked)} />启动后自动检查更新</label>}
      {state?.mode === 'installer' && <p className="form-help">只检查，不自动下载或安装。安装前请保存编辑内容；未提交的仓库修改和应用设置会保留。</p>}
      {state?.checkedAt && <p className="form-help">上次检查：{new Date(state.checkedAt).toLocaleString('zh-CN')}</p>}
      {(error || state?.error) && <div className="modal-error" role="alert">{error || state?.error}</div>}
      <div className="modal-actions">
        <button className="text-button update-release-link" onClick={() => void act('open-release')}>打开发布页</button>
        {state?.mode === 'installer' && <>
          {phase === 'downloading' ? <button className="secondary-button" onClick={() => void act('cancel')}>取消下载</button> : <button className="secondary-button" disabled={busy || phase === 'downloaded'} onClick={() => void act('check')}>{phase === 'checking' ? '检查中…' : '检查更新'}</button>}
          {state.release && (phase === 'available' || phase === 'error') && <button className="primary-button" onClick={() => void act('download')}>{phase === 'error' ? '重试下载' : '下载更新'}</button>}
          {phase === 'downloaded' && <button className="primary-button" disabled={confirming} onClick={() => void act('install')}>{confirming ? '等待确认…' : '退出并安装'}</button>}
        </>}
        {state?.mode !== 'installer' && <button className="secondary-button" onClick={() => setOpen(false)}>关闭</button>}
      </div>
    </section></div>}
  </>;
}
