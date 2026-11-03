import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalEvent, TerminalInfo } from '../shared/types';
import '@xterm/xterm/css/xterm.css';

function theme(): ITheme {
  const light = document.documentElement.dataset.theme === 'light';
  return light ? { background: '#f8fafc', foreground: '#203449', cursor: '#137859', selectionBackground: '#bddfd0', black: '#203449', red: '#b43845', green: '#137859', yellow: '#8a640f', blue: '#245cb5', magenta: '#8350a7', cyan: '#176e82', white: '#617488', brightBlack: '#617488', brightRed: '#c13c4d', brightGreen: '#178467', brightYellow: '#946d17', brightBlue: '#316ecc', brightMagenta: '#9255bb', brightCyan: '#18869b', brightWhite: '#203449' }
    : { background: '#10171f', foreground: '#dbe2e8', cursor: '#71dcb5', selectionBackground: '#294c48', black: '#18232e', red: '#f0989a', green: '#71dcb5', yellow: '#e8bc76', blue: '#86b5ff', magenta: '#c7a1eb', cyan: '#7bc9da', white: '#dbe2e8', brightBlack: '#8698aa', brightRed: '#ffacb0', brightGreen: '#91edc7', brightYellow: '#f5cf96', brightBlue: '#a8ccff', brightMagenta: '#dec0ff', brightCyan: '#a1e5ef', brightWhite: '#ffffff' };
}

export function ProjectTerminal({ sessionId, root, visible, active, onHide }: {
  sessionId: string; root: string; visible: boolean; active: boolean; onHide(): void;
}) {
  const host = useRef<HTMLDivElement>(null), terminal = useRef<Terminal | null>(null);
  const connection = useRef<{ info: TerminalInfo; sequence: number } | null>(null);
  const start = useRef<() => Promise<void>>(async () => {}), fit = useRef<() => void>(() => {});
  const focus = useRef<() => void>(() => {});
  const [info, setInfo] = useState<TerminalInfo | null>(null), [starting, setStarting] = useState(false);
  const [error, setError] = useState(''), [selection, setSelection] = useState(false), [height, setHeight] = useState(280);
  const drag = useRef<{ y: number; height: number } | null>(null);

  const clipboard = async (action: 'copy' | 'paste') => {
    const current = connection.current, term = terminal.current;
    if (!current || !term) return;
    if (action === 'copy' && !term.hasSelection()) return;
    try {
      const result = await window.harbor.terminalClipboard(sessionId, current.info.id, action, action === 'copy' ? term.getSelection() : undefined);
      if (!result.ok) setError(result.error.message);
      else if (action === 'paste' && current.info.running) { term.paste(result.data); focus.current(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const clipboardRef = useRef(clipboard); clipboardRef.current = clipboard;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false, opening = false;
    const pending: TerminalEvent[] = [];
    const term = new Terminal({ fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, theme: theme(), screenReaderMode: true, allowProposedApi: false });
    const addon = new FitAddon(); term.loadAddon(addon); term.open(host.current); terminal.current = term;
    term.textarea?.setAttribute('aria-label', '终端输入');
    focus.current = () => {
      if (!disposed && host.current?.getClientRects().length && ![...document.querySelectorAll('[aria-modal="true"]')].some(element => element.getClientRects().length)) term.focus();
    };
    const resize = () => {
      if (disposed || !host.current?.clientWidth || !host.current.clientHeight) return;
      addon.fit(); const current = connection.current;
      if (current?.info.running) window.harbor.terminalResize(sessionId, current.info.id, term.cols, term.rows);
    };
    fit.current = resize;
    const receive = (event: TerminalEvent) => {
      if (disposed || event.sessionId !== sessionId) return;
      const current = connection.current;
      if (!current) { pending.push(event); return; }
      if (event.id !== current.info.id) return;
      if (event.kind === 'exit') { current.info.running = false; setInfo({ ...current.info }); return; }
      if (event.sequence <= current.sequence) { window.harbor.terminalAck(sessionId, event.id, event.sequence); return; }
      const overlap = Math.max(0, current.sequence - (event.sequence - event.data.length)); current.sequence = event.sequence;
      term.write(event.data.slice(overlap), () => { if (!disposed) window.harbor.terminalAck(sessionId, event.id, event.sequence); });
    };
    const unsubscribe = window.harbor.onTerminal(receive);
    start.current = async () => {
      if (opening || disposed) return;
      opening = true; setStarting(true); setError(''); connection.current = null; pending.length = 0;
      try {
        resize();
        const result = await window.harbor.terminalOpen(sessionId, term.cols, term.rows);
        if (disposed) return;
        if (!result.ok) { setError(result.error.message); return; }
        const snapshot = result.data; connection.current = { info: snapshot.info, sequence: snapshot.sequence }; setInfo(snapshot.info);
        term.reset(); term.write(snapshot.output);
        for (const event of pending.splice(0)) receive(event);
        resize(); focus.current();
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : String(e)); }
      finally { opening = false; if (!disposed) setStarting(false); }
    };
    const input = term.onData(data => {
      const current = connection.current;
      if (!current?.info.running) return;
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(data.length, offset + 32768);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
        window.harbor.terminalInput(sessionId, current.info.id, data.slice(offset, end)); offset = end;
      }
    });
    const selected = term.onSelectionChange(() => setSelection(term.hasSelection()));
    term.attachCustomKeyEventHandler(event => {
      if (event.ctrlKey && event.code === 'Backquote') return false;
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && ['KeyC', 'KeyV'].includes(event.code)) { event.preventDefault(); void clipboardRef.current(event.code === 'KeyC' ? 'copy' : 'paste'); return false; }
      return true;
    });
    const observer = new ResizeObserver(resize); observer.observe(host.current);
    const colors = new MutationObserver(() => { term.options.theme = theme(); }); colors.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    void document.fonts.ready.then(() => { if (!disposed) resize(); });
    void start.current();
    return () => { disposed = true; observer.disconnect(); colors.disconnect(); input.dispose(); selected.dispose(); unsubscribe(); term.dispose(); terminal.current = null; connection.current = null; };
  }, [sessionId]);

  useEffect(() => {
    if (!visible || !active) return;
    const frame = requestAnimationFrame(() => { fit.current(); focus.current(); });
    return () => cancelAnimationFrame(frame);
  }, [visible, active]);

  const stop = async () => {
    const current = connection.current; if (!current) return;
    try {
      const result = await window.harbor.terminalStop(sessionId, current.info.id);
      if (!result.ok) setError(result.error.message);
      else { current.info.running = false; setInfo({ ...current.info }); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <section className="project-terminal" role="region" aria-label="项目终端" hidden={!visible} style={{ height }} data-terminal-id={info?.id} data-terminal-pid={info?.pid}>
    <div className="terminal-resize" role="separator" aria-label="调整终端高度" aria-orientation="horizontal" tabIndex={0}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setHeight(value => Math.min(window.innerHeight * .55, Math.max(160, value + (event.key === 'ArrowUp' ? 24 : -24)))); } }}
      onPointerDown={event => { drag.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) setHeight(Math.min(window.innerHeight * .55, Math.max(160, drag.current.height + drag.current.y - event.clientY))); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} />
    <header className="terminal-toolbar"><div className="terminal-heading"><span className={`terminal-dot ${info?.running ? 'running' : ''}`} /><strong>终端</strong><span>{starting ? '正在启动…' : info ? info.running ? info.shell.replace(/\.exe$/i, '') : '已结束' : '未启动'}</span><small title={root}>{root}</small></div>
      <div className="terminal-actions"><button className="text-button" disabled={!selection} onClick={() => void clipboard('copy')} title="Ctrl+Shift+C">复制</button><button className="text-button" disabled={!info?.running} onClick={() => void clipboard('paste')} title="Ctrl+Shift+V">粘贴</button><button className="text-button" disabled={!info} onClick={() => { terminal.current?.clear(); focus.current(); }}>清屏</button>{info?.running ? <button className="text-button" onClick={() => void stop()}>结束终端</button> : <button className="text-button" disabled={starting} onClick={() => void start.current()}>重新启动</button>}<button className="icon-button" aria-label="收起终端" title="收起终端 · 保留会话" onClick={onHide}>×</button></div>
    </header>
    {error && <div className="terminal-error" role="alert">{error}<button aria-label="关闭终端错误" onClick={() => setError('')}>×</button></div>}
    <div className="terminal-host" ref={host} />
  </section>;
}
