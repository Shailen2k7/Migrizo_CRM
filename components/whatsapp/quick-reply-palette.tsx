'use client';

// =============================================================================
// QUICK REPLY PALETTE — the "/" command menu inside the composer.
//
// Type "/" as the first character of the box and this opens; keep typing to
// filter; ↑↓ move, Enter inserts, Esc closes. The PARENT owns the open state,
// the query and the selected index — the palette is a pure view, which is what
// keeps the textarea's key handling in one place instead of two components
// fighting over keydown.
//
// Matching: shortcut prefix beats title beats body, so "/gu" finds /guide
// before anything that merely mentions the word.
// =============================================================================
import { Paperclip, CornerDownLeft, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WaSavedReply } from '@/lib/whatsapp/types';

/** Rank replies for a query. Exported so the parent's key handling and this
 *  view are always looking at the same list in the same order. */
export function filterReplies(replies: WaSavedReply[], query: string): WaSavedReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return replies;
  const scored = replies.map((r) => {
    const s = r.shortcut.toLowerCase(), t = r.title.toLowerCase(), b = r.body.toLowerCase();
    let score = 0;
    if (s.startsWith(q)) score = 100;
    else if (s.includes(q)) score = 80;
    else if (t.startsWith(q)) score = 60;
    else if (t.includes(q)) score = 40;
    else if (b.includes(q)) score = 20;
    return { r, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.r.sort_order - b.r.sort_order);
  return scored.map((x) => x.r);
}

export default function QuickReplyPalette({
  replies, query, selectedIndex, onPick, onHover, onManage,
}: {
  replies: WaSavedReply[];          // already filtered by the parent
  query: string;
  selectedIndex: number;
  onPick: (r: WaSavedReply) => void;
  onHover: (index: number) => void;
  onManage: () => void;
}) {
  return (
    <div className="absolute bottom-full left-2 z-30 mb-2 w-[400px] max-w-[calc(100%-16px)] overflow-hidden rounded-2xl border border-[#E3E6ED] bg-white shadow-[0_20px_50px_-16px_rgba(15,23,40,.28),0_2px_8px_rgba(15,23,40,.06)]">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-[#F0F1F5] px-3.5 py-2">
        <span className="flex h-[20px] items-center rounded-md border border-[#E3E6ED] bg-[#F7F8FA] px-1.5 font-mono text-[11px] font-bold text-[#697086]">/</span>
        <span className="text-[11px] font-bold uppercase tracking-[.07em] text-[#8A90A5]">Quick replies</span>
        {query && (
          <span className="truncate rounded-md bg-[#EDFAF1] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#1B7A44]">“{query}”</span>
        )}
        <button
          onMouseDown={(e) => { e.preventDefault(); onManage(); }}
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-[#8A90A5] transition hover:bg-[#F4F5F8] hover:text-[#0F1728]"
        >
          <SlidersHorizontal className="h-3 w-3" /> Manage
        </button>
      </div>

      {/* results */}
      <div className="max-h-[300px] overflow-y-auto p-1.5">
        {replies.length === 0 && (
          <p className="m-0 px-3 py-5 text-center text-[12px] text-[#8A90A5]">
            Nothing matches “{query}”. Create it in the <b>Quick replies</b> tab.
          </p>
        )}
        {replies.map((r, i) => (
          <button
            key={r.id}
            // mousedown, not click — click would blur the textarea first and
            // collapse the palette before the pick lands.
            onMouseDown={(e) => { e.preventDefault(); onPick(r); }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'mb-0.5 block w-full rounded-xl px-3 py-2 text-left transition-colors last:mb-0',
              i === selectedIndex ? 'bg-[#EDFAF1]' : 'hover:bg-[#F7F8FA]'
            )}
          >
            <span className="flex items-center gap-2">
              <code className={cn(
                'rounded-md px-1.5 py-px font-mono text-[10.5px] font-bold',
                i === selectedIndex ? 'bg-[#D7F3E1] text-[#1B7A44]' : 'bg-[#F4F5F8] text-[#697086]'
              )}>/{r.shortcut}</code>
              <b className="min-w-0 flex-1 truncate text-[12.6px] font-semibold text-[#0F1728]">{r.title}</b>
              {r.media_path && (
                <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-[#E3E6ED] bg-white px-1.5 py-px text-[9.5px] font-bold text-[#697086]"
                      title={r.media_name ?? 'attachment'}>
                  <Paperclip className="h-2.5 w-2.5" /> file
                </span>
              )}
              {i === selectedIndex && (
                <CornerDownLeft className="h-3 w-3 flex-shrink-0 text-[#1B7A44]" />
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11.3px] leading-[1.5] text-[#8A90A5]">
              {r.body.replace(/\s+/g, ' ')}
            </span>
          </button>
        ))}
      </div>

      {/* footer — the whole keyboard story in one quiet line */}
      <div className="flex items-center gap-3 border-t border-[#F0F1F5] bg-[#FBFBFC] px-3.5 py-[7px] text-[10px] font-medium text-[#A6ACBF]">
        <span><b className="font-bold text-[#8A90A5]">↑↓</b> choose</span>
        <span><b className="font-bold text-[#8A90A5]">Enter</b> insert</span>
        <span><b className="font-bold text-[#8A90A5]">Esc</b> close</span>
        <span className="ml-auto">links &amp; files go with it</span>
      </div>
    </div>
  );
}
