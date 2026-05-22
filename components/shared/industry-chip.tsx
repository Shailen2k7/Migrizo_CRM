'use client';

import { Cpu, Microscope, Palette, Wrench, GraduationCap, Briefcase, Stethoscope, Banknote, CircleDot } from 'lucide-react';
import type { Industry } from '@/lib/types';
import { INDUSTRY_LIST, INDUSTRY_META, getIndustryMeta } from '@/lib/types';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<Industry, React.ComponentType<{ className?: string }>> = {
  tech:        Cpu,
  research:    Microscope,
  art:         Palette,
  engineering: Wrench,
  education:   GraduationCap,
  business:    Briefcase,
  healthcare:  Stethoscope,
  finance:     Banknote,
  other:       CircleDot,
};

interface ChipProps {
  industry: string | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export function IndustryChip({ industry, size = 'sm', className }: ChipProps) {
  const meta = getIndustryMeta(industry);
  if (!meta) return null;
  const Icon = ICON_MAP[industry as Industry] || CircleDot;

  const sizeClasses = {
    xs: 'gap-0.5 px-1.5 py-0.5 text-[10px]',
    sm: 'gap-1 px-2 py-0.5 text-[11px]',
    md: 'gap-1.5 px-2.5 py-1 text-[12px]',
  };
  const iconSize = size === 'xs' ? 'w-2.5 h-2.5' : size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <span
      className={cn('inline-flex items-center rounded-full font-medium whitespace-nowrap', sizeClasses[size], className)}
      style={{ background: meta.bg, color: meta.fg }}
    >
      <Icon className={iconSize} />
      {meta.label}
    </span>
  );
}

interface SelectorProps {
  value: string | null;
  onChange: (v: Industry | null) => void;
  size?: 'sm' | 'md';
}

export function IndustrySelector({ value, onChange, size = 'md' }: SelectorProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {INDUSTRY_LIST.map((ind) => {
        const meta = INDUSTRY_META[ind];
        const Icon = ICON_MAP[ind];
        const selected = value === ind;
        return (
          <button
            key={ind}
            type="button"
            onClick={() => onChange(selected ? null : ind)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full font-medium transition-all',
              size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]',
              selected ? 'ring-2 ring-offset-1' : 'opacity-50 hover:opacity-100 hover:scale-105',
            )}
            style={{
              background: meta.bg,
              color: meta.fg,
              // @ts-expect-error — CSS custom property for ring color
              '--tw-ring-color': meta.ring,
            }}
          >
            <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
