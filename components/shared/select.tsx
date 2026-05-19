'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  color?: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

export function Select<T extends string>({ value, onChange, options, placeholder = 'Select…', disabled, className, size = 'md', fullWidth = true }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    if (open) {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const padding = size === 'sm' ? 'py-1.5 px-2.5 text-[12px]' : 'py-2 px-3 text-[13px]';

  return (
    <div className={cn('relative', fullWidth ? 'w-full' : 'inline-block', className)} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full inline-flex items-center justify-between gap-2 rounded-md border border-border bg-surface text-left',
          'hover:border-ink-3 transition-colors',
          'focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft',
          padding,
          disabled && 'opacity-50 cursor-not-allowed',
          open && 'border-indigo ring-4 ring-indigo-soft'
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          {current?.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: current.color }} />}
          <span className={cn('truncate', current ? 'text-ink' : 'text-faint')}>
            {current ? current.label : placeholder}
          </span>
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-muted transition-transform flex-shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-surface border border-border rounded-md shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="max-h-[260px] overflow-y-auto py-1">
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2',
                    'hover:bg-surface-2 transition-colors',
                    selected && 'bg-indigo-soft/40'
                  )}
                >
                  {opt.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: opt.color }} />}
                  <span className="flex-1 min-w-0">
                    <span className={cn('block truncate', selected && 'font-semibold text-ink')}>{opt.label}</span>
                    {opt.hint && <span className="block text-[10.5px] text-muted truncate">{opt.hint}</span>}
                  </span>
                  {selected && <Check className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
