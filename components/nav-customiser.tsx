'use client';

// =============================================================================
// CUSTOMISE MENU — drag to reorder, switch to move something under "More".
// -----------------------------------------------------------------------------
// Everything applies as you do it. There is no Save button, because a Save
// button on a preference like this only creates a way to lose the change.
// Close it and it stays; press Reset and the built-in order comes back.
//
// WHY NOT A DRAG LIBRARY
// One list, vertical only, a dozen rows. The browser's own drag events cover
// that in a few lines and add nothing to the bundle. The row being dragged
// dims, the row under the cursor shows the line where it will land, and the
// list reorders on drop — which is the whole of what this needs to feel right.
//
// Keyboard works too: the arrow buttons on each row move it up and down, so
// this is usable without a mouse and on a touchscreen where dragging inside a
// scrolling modal is awkward.
// =============================================================================

import { useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, X, RotateCcw, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavPrefs } from '@/lib/nav-prefs';

export interface CustomisableItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function NavCustomiser({ items, prefs, onChange, onReset, onClose }: {
  items: CustomisableItem[];          // already ordered + role-filtered
  prefs: NavPrefs;
  onChange: (next: NavPrefs) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const order = items.map((i) => i.href);
  const inMore = new Set(prefs.more);

  const commit = (nextOrder: string[], nextMore?: Set<string>) =>
    onChange({ order: nextOrder, more: [...(nextMore ?? inMore)] });

  const move = (href: string, delta: number) => {
    const from = order.indexOf(href);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    commit(next);
  };

  const drop = (target: string) => {
    if (!dragging || dragging === target) { setDragging(null); setOver(null); return; }
    const next = [...order];
    const from = next.indexOf(dragging);
    next.splice(from, 1);
    next.splice(next.indexOf(target) + (next.indexOf(target) < from ? 0 : 1), 0, dragging);
    commit(next);
    setDragging(null); setOver(null);
  };

  const toggleMore = (href: string) => {
    const next = new Set(inMore);
    if (next.has(href)) next.delete(href); else next.add(href);
    commit(order, next);
  };

  const mainCount = items.filter((i) => !inMore.has(i.href)).length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fadeIn" />

      <div className="relative w-full max-w-[440px] max-h-[86vh] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl animate-pageIn">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15.5px] font-semibold tracking-tight">Customise menu</h2>
            <p className="mt-1 text-[12.3px] leading-relaxed text-muted">
              Drag to reorder. Switch anything off to tuck it under <b className="text-ink-2">More</b> at
              the bottom of the menu — it stays one click away.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-faint transition hover:bg-surface-2 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {items.map((item, idx) => {
            const Icon = item.icon;
            const hidden = inMore.has(item.href);
            return (
              <div
                key={item.href}
                draggable
                onDragStart={() => setDragging(item.href)}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onDragOver={(e) => { e.preventDefault(); setOver(item.href); }}
                onDrop={(e) => { e.preventDefault(); drop(item.href); }}
                className={cn(
                  'group flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition',
                  dragging === item.href ? 'opacity-40' : 'opacity-100',
                  over === item.href && dragging && dragging !== item.href
                    ? 'border-indigo bg-[hsl(var(--indigo-soft))]'
                    : 'border-transparent hover:bg-surface-2',
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-faint active:cursor-grabbing" />
                <Icon className={cn('h-[17px] w-[17px] shrink-0', hidden ? 'text-faint' : 'text-ink-2')} />
                <span className={cn('flex-1 truncate text-[13.2px]', hidden ? 'text-muted' : 'font-medium text-ink')}>
                  {item.label}
                </span>

                {/* Keyboard / touch reordering, for when dragging is awkward. */}
                <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button onClick={() => move(item.href, -1)} disabled={idx === 0} aria-label={`Move ${item.label} up`}
                    className="rounded-md p-1 text-faint transition hover:bg-surface hover:text-ink disabled:opacity-25">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => move(item.href, 1)} disabled={idx === items.length - 1} aria-label={`Move ${item.label} down`}
                    className="rounded-md p-1 text-faint transition hover:bg-surface hover:text-ink disabled:opacity-25">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  onClick={() => toggleMore(item.href)}
                  role="switch"
                  aria-checked={!hidden}
                  aria-label={hidden ? `Show ${item.label} in the menu` : `Move ${item.label} under More`}
                  title={hidden ? 'Under More — click to show in the menu' : 'In the menu — click to move under More'}
                  className={cn('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
                    hidden ? 'bg-[hsl(var(--border))]' : 'bg-indigo')}
                >
                  <span className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left]',
                    hidden ? 'left-[3px]' : 'left-[19px]')} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-5 py-3">
          <span className="flex items-center gap-1.5 text-[11.8px] text-muted">
            <Menu className="h-3.5 w-3.5" />
            {mainCount} in the menu
            {inMore.size > 0 && <> · {inMore.size} under More</>}
          </span>
          <button onClick={onReset}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.2px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button onClick={onClose} className="btn btn-primary btn-sm">Done</button>
        </div>
      </div>
    </div>
  );
}
