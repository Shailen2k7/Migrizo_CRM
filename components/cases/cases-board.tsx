'use client';

import { useState } from 'react';
import type { Case } from '@/lib/types';
import { initials, avatarColor } from '@/lib/utils';
import { DELIVERY_STAGES, deliveryStageOf, type DeliveryStageKey } from '@/lib/delivery-stages';

// Count overdue tasks on a case (due in the past, not done). Reads the same
// journey.tasks the drawer writes, so the badge always matches what's inside.
function overdueCountOf(c: Case): number {
  const tasks = (c.journey as { tasks?: Record<string, { done?: boolean; due?: string }> } | null | undefined)?.tasks;
  if (!tasks) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let n = 0;
  for (const t of Object.values(tasks)) {
    if (t?.due && !t.done && new Date(t.due) < today) n++;
  }
  return n;
}

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
              style={{
                background: st.tint,
                border: `1.5px solid ${isOver ? st.accent : `${st.accent}55`}`,
                boxShadow: isOver ? `0 0 0 3px ${st.accent}2E` : '0 1px 2px rgba(15,17,21,0.04)',
              }}
              onDragOver={(e) => { e.preventDefault(); setOverKey(st.key); }}
              onDragLeave={() => setOverKey((k) => (k === st.key ? null : k))}
              onDrop={() => { if (dragId) onMove(dragId, st.key); setDragId(null); setOverKey(null); }}
            >
              {/* Column header */}
              <div className="px-3.5 pt-3 pb-2.5 border-b" style={{ borderColor: `${st.accent}33` }}>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: st.accent }} />
                  <span className="text-[13px] font-bold truncate" style={{ color: st.accent }}>{st.label}</span>
                  <span className="ml-auto text-[11.5px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.75)', color: st.accent }}>{items.length}</span>
                </div>
              </div>
              {/* Cards */}
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                {items.map((c) => {
                  const overdue = overdueCountOf(c);
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => { setDragId(null); setOverKey(null); }}
                      onClick={() => onOpen(c.id)}
                      className="relative border rounded-[10px] px-2.5 py-2 cursor-pointer hover:shadow-md transition-shadow"
                      style={{
                        opacity: dragId === c.id ? 0.4 : 1,
                        background: overdue ? '#FFF8F9' : 'hsl(var(--surface))',
                        borderColor: overdue ? '#FECDD3' : 'hsl(var(--border))',
                      }}
                    >
                      {overdue > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white"
                          style={{ background: '#E11D48', border: '2px solid hsl(var(--surface))', boxShadow: '0 2px 6px rgba(225,29,72,0.4)' }}
                          title={`${overdue} overdue`}>
                          {overdue}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="av flex-shrink-0" style={{ background: avatarColor(c.id), width: 24, height: 24, fontSize: 10 }}>{initials(c.client_name)}</div>
                        <span className="text-[12.5px] font-medium text-ink truncate flex-1">{c.client_name}</span>
                      </div>
                      <div className="text-[10.5px] mt-1 truncate" style={{ color: overdue ? '#E11D48' : 'hsl(var(--muted))' }}>
                        {overdue > 0 ? `⚠ ${overdue} overdue` : `${(c.visa_type || 'gtv').toUpperCase()}${c.client_phone ? ` · ${c.client_phone}` : ''}`}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="border border-dashed rounded-[10px] py-7 text-center text-[11.5px]" style={{ borderColor: `${st.accent}55`, color: st.accent, opacity: 0.7 }}>Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
