import { useEffect, useState, type FormEvent } from 'react';
import type { AiSettings, AiSettingsInput } from '../shared/types';

export function AiSettingsDialog({ onClose }: { onClose(): void }) {
  const [settings, setSettings] = useState<AiSettingsInput>({ baseUrl: 'https://api.openai.com/v1', model: '', protocol: 'responses', language: 'zh', style: 'conventional' });
  const [stored, setStored] = useState<AiSettings | null>(null);
  const [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('');
  useEffect(() => { let live = true; void window.harbor.aiSettings().then(result => { if (!live) return; if (result.ok) { setStored(result.data); setSettings(result.data); } else setError(result.error.message); }).catch(e => { if (live) setError(String(e)); }).finally(() => { if (live) setBusy(false); }); return () => { live = false; }; }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await window.harbor.saveAiSettings({ baseUrl: settings.baseUrl, model: settings.model, protocol: settings.protocol, language: settings.language, style: settings.style, ...(key ? { apiKey: key } : {}), clearApiKey: clearKey });
      if (!result.ok) { setError(result.error.message); return; }
      setKey(''); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><section className="modal ai-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
    <div className="modal-header"><div><span className="eyebrow">AI COMMIT ASSISTANT</span><h2 id="ai-settings-title">AI 设置</h2></div><button className="icon-button" aria-label="关闭 AI 设置" disabled={busy} onClick={onClose}>×</button></div>
    <form onSubmit={event => void submit(event)}>
      <label>API 协议<select aria-label="AI 协议" value={settings.protocol} onChange={e => setSettings(v => ({ ...v, protocol: e.target.value as AiSettingsInput['protocol'] }))} disabled={busy}><option value="responses">OpenAI Responses</option><option value="chat-completions">Chat Completions（兼容接口）</option></select></label>
      <label>服务基础地址<input aria-label="AI 服务地址" type="url" value={settings.baseUrl} placeholder="https://api.example.com/v1" onChange={e => setSettings(v => ({ ...v, baseUrl: e.target.value }))} required disabled={busy} /></label>
      <p className="form-help">填写基础地址，通常以 /v1 结尾。应用按所选协议追加 /responses 或 /chat/completions。</p>
      <label>模型 ID<input aria-label="AI 模型" value={settings.model} placeholder="填写此服务支持的模型 ID" onChange={e => setSettings(v => ({ ...v, model: e.target.value }))} required disabled={busy} /></label>
      <label>API Key<input aria-label="AI API Key" type="password" autoComplete="off" value={key} placeholder={stored?.hasApiKey ? '已配置，留空保留' : '本地无鉴权服务可留空'} onChange={e => setKey(e.target.value)} disabled={busy} /></label>
      {stored?.hasApiKey && <label className="checkbox-label"><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)} disabled={busy} />清除已保存的 Key</label>}
      <p className="form-help">Key 在主进程中使用系统加密保存，更换服务地址后需重新填写。{stored?.keyStorage === 'memory' ? '当前系统不支持加密存储，Key 仅在本次会话有效。' : ''}</p>
      <div className="ai-settings-columns"><label>消息语言<select aria-label="AI 消息语言" value={settings.language} onChange={e => setSettings(v => ({ ...v, language: e.target.value as 'zh' | 'en' }))} disabled={busy}><option value="zh">中文</option><option value="en">English</option></select></label><label>消息格式<select aria-label="AI 消息格式" value={settings.style} onChange={e => setSettings(v => ({ ...v, style: e.target.value as 'conventional' | 'simple' }))} disabled={busy}><option value="conventional">Conventional Commits</option><option value="simple">简洁描述</option></select></label></div>
      <p className="ai-data-note">点击“AI 生成”时，会将暂存文件清单和暂存区文本差异发送到此服务。生成结果先预览，应用后仍可编辑。</p>
      {error && <div className="modal-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '正在处理…' : '保存 AI 设置'}</button></div>
    </form>
  </section></div>;
}
