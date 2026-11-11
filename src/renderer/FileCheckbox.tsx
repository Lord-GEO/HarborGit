import { useEffect, useRef } from 'react';

export function FileCheckbox({ label, checked, mixed = false, disabled, title, onChange }: {
  label: string; checked: boolean; mixed?: boolean; disabled: boolean; title?: string; onChange(checked: boolean): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} className="file-checkbox" type="checkbox" aria-label={label}
    aria-checked={mixed ? 'mixed' : checked} checked={checked} disabled={disabled} title={title}
    onChange={event => onChange(event.target.checked)} />;
}
