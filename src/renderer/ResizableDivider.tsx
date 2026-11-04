import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

type Options = { storageKey: string; initial: number; min: number; max: number; remaining: number; label: string };
const gutter = 12;

// Persist only a preferred width. CSS and the divider clamp it to the available
// space, so a narrow window never permanently overwrites a wider layout.
export function useResizablePanel(options: Options) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`harbor-panel-${options.storageKey}`));
      if (Number.isFinite(saved) && saved >= options.min && saved <= options.max) return saved;
    } catch { /* Layout preferences are optional. */ }
    return options.initial;
  });
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try { localStorage.setItem(`harbor-panel-${options.storageKey}`, String(Math.round(width))); } catch { /* Read-only storage. */ }
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [width, options.storageKey]);
  const panelStyle: CSSProperties = {
    width: `clamp(${options.min}px, ${width}px, min(${options.max}px, calc(100% - ${options.remaining + gutter}px)))`,
    minWidth: 0, maxWidth: 'none', flexShrink: 0,
  };
  return { panelStyle, divider: <ResizableDivider {...options} width={width} onWidth={setWidth} /> };
}

function ResizableDivider({ initial, min, max, remaining, label, width, onWidth }: Options & { width: number; onWidth(value: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const [available, setAvailable] = useState(max);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const style = getComputedStyle(parent);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setAvailable(Math.max(min, Math.min(max, parent.clientWidth - padding - remaining - gutter)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [min, max, remaining]);
  const effective = Math.max(min, Math.min(available, width));
  const update = (value: number) => onWidth(Math.round(Math.max(min, Math.min(available, value))));
  const keyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') update(effective - step);
    else if (event.key === 'ArrowRight') update(effective + step);
    else if (event.key === 'Home') update(min);
    else if (event.key === 'End') update(available);
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  return <div ref={ref} className="panel-divider" role="separator" aria-label={label}
    aria-orientation="vertical" aria-valuemin={min} aria-valuemax={available} aria-valuenow={effective}
    tabIndex={0} title="拖拽调整宽度，双击恢复默认" onKeyDown={keyboard} onDoubleClick={() => onWidth(initial)}
    onPointerDown={event => {
      if (event.button !== 0 || !ref.current) return;
      event.preventDefault();
      drag.current = { pointer: event.pointerId, x: event.clientX, width: ref.current.previousElementSibling?.getBoundingClientRect().width || effective };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.resizing = 'true';
    }} onPointerMove={event => {
      if (drag.current?.pointer === event.pointerId) update(drag.current.width + event.clientX - drag.current.x);
    }} onPointerUp={event => {
      if (drag.current?.pointer !== event.pointerId) return;
      drag.current = null; delete event.currentTarget.dataset.resizing;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onLostPointerCapture={event => { drag.current = null; delete event.currentTarget.dataset.resizing; }}
    onPointerCancel={event => { drag.current = null; delete event.currentTarget.dataset.resizing; }} />;
}
