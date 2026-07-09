'use client';

import { useState } from 'react';
import type { Case } from '@/lib/types';
import { initials, avatarColor } from '@/lib/utils';
import { DELIVERY_STAGES, deliveryStageOf, type DeliveryStageKey } from '@/lib/delivery-stages';

// =============================================================================
// CASES BOARD — a 9-column delivery-status kanban. Drag a case card between
// columns to update its delivery_stage. Columns scroll internally (the board
// scrolls horizontally); on mobile ~3 columns are visible.
// =============================================================================
export function CasesBoard({
  cases, onOpen, onMove, search,
}: {
  cases: Case[];
  onOpen: (id: string) => void;
  onMove: (id: string, stage: DeliveryStageKey) => void;
  search: string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const visible = q ? cases.filter((c) => (c.client_name || '').toLowerCase().includes(q)) : cases;

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden -mx-1 px-1" style={{ overscrollBehavior: 'contain' }}>
      <div className="flex gap-3 pb-2 pr-8" style={{ minHeight: 420, height: 'calc(100dvh - 230px)' }}>
        {DELIVERY_STAGES.map((st) => {
          const items = visible.filter((c) => deliveryStageOf(c) === st.key);
          const isOver = overKey === st.key;
          return (
            <div
              key={st.key}
              className="flex flex-col w-[31vw] sm:w-[230px] flex-shrink-0 rounded-[14px] transition-all"
              style={{ background: isOver ? st.tint : '#F7F8FA', border: `1.5px solid ${isOver ? st.accent : 'transparent'}` }}
              onDragOver={(e) => { e.preventDefault(); setOverKey(st.key); }}
              onDragLeave={() => setOverKey((k) => (k === st.key ? null : k))}
              onDrop={() => { if (dragId) onMove(dragId, st.key); setDragId(null); setOverKey(null); }}
            >
              {/* Column header */}
              <div className="px-3 pt-3 pb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: st.accent }} />
                <span className="text-[12.5px] font-bold truncate" style={{ color: st.accent }}>{st.label}</span>
                <span className="ml-auto text-[11px] font-semibold text-muted bg-surface rounded-full px-1.5 py-0.5">{items.length}</span>
              </div>
              {/* Cards */}
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                {items.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => { setDragId(null); setOverKey(null); }}
                    onClick={() => onOpen(c.id)}
                    className="bg-surface border border-border rounded-[10px] px-2.5 py-2 cursor-pointer hover:shadow-md transition-shadow"
                    style={{ opacity: dragId === c.id ? 0.4 : 1 }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="av flex-shrink-0" style={{ background: avatarColor(c.id), width: 24, height: 24, fontSize: 10 }}>{initials(c.client_name)}</div>
                      <span className="text-[12.5px] font-medium text-ink truncate flex-1">{c.client_name}</span>
                    </div>
                    <div className="text-[10.5px] text-muted mt-1 truncate">{(c.visa_type || 'gtv').toUpperCase()}{c.client_phone ? ` · ${c.client_phone}` : ''}</div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-[11px] text-faint text-center py-6 border border-dashed border-border rounded-[10px]">Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
