'use client';

// =============================================================================
// FIELD SYSTEM — the WhatsApp module's form controls, in one place.
//
// Native <select>/<input> chrome is what makes a UI look decades old. These
// primitives keep native semantics (accessibility, keyboard, mobile pickers)
// but replace every pixel of the browser's default look: soft-filled resting
// state, hairline border, brand-green focus glow, custom chevron.
//
// Use these everywhere in the module — never a bare <input>/<select>.
// =============================================================================
import { ChevronDown } from 'lucide-react';

export const FIELD =
  'h-[34px] w-full rounded-[10px] border border-[#E3E6ED] bg-[#FAFBFC] px-[11px] ' +
  'text-[12.4px] font-medium text-ink shadow-[inset_0_1px_2px_rgba(15,23,40,.03)] ' +
  'outline-none transition-all placeholder:text-[#A6ACBF] hover:border-[#CBD1DD] ' +
  'focus:border-[#25A25A] focus:bg-white focus:shadow-[0_0_0_3.5px_rgba(37,162,90,.13)]';

export const FIELD_AREA =
  'w-full resize-y rounded-[10px] border border-[#E3E6ED] bg-[#FAFBFC] px-[11px] py-2 ' +
  'text-[12.4px] font-medium leading-[1.55] text-ink shadow-[inset_0_1px_2px_rgba(15,23,40,.03)] ' +
  'outline-none transition-all placeholder:text-[#A6ACBF] hover:border-[#CBD1DD] ' +
  'focus:border-[#25A25A] focus:bg-white focus:shadow-[0_0_0_3.5px_rgba(37,162,90,.13)]';

/** Styled <select> — native semantics, custom chrome, real chevron. */
export function Select({ value, onChange, children, className, ariaLabel }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
  className?: string; ariaLabel?: string;
}) {
  return (
    <span className={`relative inline-flex min-w-0 ${className ?? ''}`}>
      <select
        value={value} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} min-w-0 flex-1 cursor-pointer appearance-none truncate pr-8 font-semibold`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-[10px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#697086]" />
    </span>
  );
}

/** Text input with an icon INSIDE the field (the Stripe pattern). */
export function IconInput({ icon, value, onChange, placeholder, ariaLabel }: {
  icon: React.ReactNode; value: string; onChange: (v: string) => void;
  placeholder?: string; ariaLabel?: string;
}) {
  return (
    <span className="relative flex min-w-0 flex-1">
      <span className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[#8A90A5]">{icon}</span>
      <input
        value={value} placeholder={placeholder} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} pl-8`}
      />
    </span>
  );
}

/** Compact centred number field, spinners hidden. */
export function NumField({ value, onChange, min = 1, max = 999, width = 'w-[58px]' }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; width?: string;
}) {
  return (
    <input
      type="number" min={min} max={max} value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      className={`${FIELD} ${width} [appearance:textfield] text-center font-bold [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
    />
  );
}
