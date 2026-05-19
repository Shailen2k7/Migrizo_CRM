'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState
} from '@tanstack/react-table';
import { ChevronDown, Phone, Mail, ArrowUp, ArrowDown, Filter, Search } from 'lucide-react';
import { useApp } from '@/components/shared/app-provider';
import type { Lead, LeadStage } from '@/lib/types';
import { STAGE_META, STAGE_ORDER, PAYMENT_META } from '@/lib/types';
import { initials, avatarColor, formatINRFull, scoreColor, timeAgo, cn } from '@/lib/utils';

type Segment = 'all' | LeadStage;

interface Props {
  initialSegment?: Segment;
  onRowClick: (id: string) => void;
}

export function LeadsTable({ initialSegment = 'all', onRowClick }: Props) {
  const { leads, updateLead } = useApp();
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updated_at', desc: true }]);
  const [stageMenu, setStageMenu] = useState<{ leadId: string; x: number; y: number } | null>(null);

  useEffect(() => setSegment(initialSegment), [initialSegment]);

  const segmented = useMemo(() => {
    if (segment === 'all') return leads;
    return leads.filter((l) => l.stage === segment);
  }, [leads, segment]);

  const counts = useMemo(() => {
    const c: Record<Segment, number> = {
      all: leads.length, hot: 0, cold: 0, mr_coming_soon: 0, invoice_sent: 0, won: 0, junk: 0,
    };
    leads.forEach((l) => { c[l.stage] = (c[l.stage] || 0) + 1; });
    return c;
  }, [leads]);

  const columns = useMemo<ColumnDef<Lead>[]>(() => [
    {
      id: 'name', accessorKey: 'full_name', header: 'Client',
      cell: ({ row }) => {
        const l = row.original;
        return (
          <div className="flex items-center gap-2.5 group relative">
            <div className="av" style={{ background: avatarColor(l.id) }}>{initials(l.full_name)}</div>
            <div className="min-w-0">
              <div className="font-semibold text-ink leading-tight text-[13.5px]">{l.full_name}</div>
              {l.visa_type && <div className="text-[11px] text-muted truncate">{l.visa_type}</div>}
            </div>
            {(l.phone || l.email) && (
              <div className="absolute left-0 -top-2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-ink text-surface px-3 py-2 rounded-md text-[11.5px] whitespace-nowrap z-30 shadow-lg">
                {l.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{l.phone}</div>}
                {l.email && <div className="flex items-center gap-1.5 mt-0.5"><Mail className="w-3 h-3" />{l.email}</div>}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'contact', header: 'Contact',
      cell: ({ row }) => {
        const l = row.original;
        const stop = (e: React.MouseEvent) => e.stopPropagation();
        return (
          <div className="flex items-center gap-3">
            {l.phone ? (
              <a href={`tel:${l.phone}`} onClick={stop} className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-indigo-600 font-medium transition-colors" title={`Call ${l.phone}`}>
                <Phone className="w-3.5 h-3.5" /> Call
              </a>
            ) : <span className="text-faint text-[12.5px]">—</span>}
            {l.email && (
              <a href={`mailto:${l.email}`} onClick={stop} className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-indigo-600 transition-colors" title={`Email ${l.email}`}>
                <Mail className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        );
      },
    },
    {
      id: 'stage', accessorKey: 'stage', header: 'Tag',
      cell: ({ row }) => {
        const l = row.original; const s = STAGE_META[l.stage];
        return (
          <button onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setStageMenu({ leadId: l.id, x: r.left, y: r.bottom + 4 }); }}
            className="stage-pill" style={{ background: s.bg, color: s.fg }}>
            <span className="chip-dot" style={{ background: s.dot }} />{s.label}<ChevronDown className="w-3 h-3 opacity-50" />
          </button>
        );
      },
      sortingFn: (a, b) => STAGE_ORDER.indexOf(a.original.stage) - STAGE_ORDER.indexOf(b.original.stage),
    },
    {
      id: 'score', accessorKey: 'score', header: 'Score',
      cell: ({ row }) => {
        const s = row.original.score;
        return (
          <div className="flex items-center gap-2">
            <div className="score-track"><div className="h-full rounded-full transition-all" style={{ width: `${s}%`, background: scoreColor(s) }} /></div>
            <span className="num text-[12.5px] font-semibold" style={{ color: scoreColor(s) }}>{s}</span>
          </div>
        );
      },
    },
    {
      id: 'pay', accessorKey: 'payment_status', header: 'Payment',
      cell: ({ row }) => { const p = PAYMENT_META[row.original.payment_status]; return <span className="chip" style={{ background: p.bg, color: p.fg }}>{p.label}</span>; },
    },
    {
      id: 'amount', accessorKey: 'amount_paid', header: 'Amount paid',
      cell: ({ row }) => { const a = row.original.amount_paid; return <span className={cn('num text-[13px] font-semibold', a ? 'text-ink' : 'text-faint')}>{a ? formatINRFull(a) : '—'}</span>; },
    },
    {
      id: 'note', header: 'Last note',
      cell: ({ row }) => {
        const l = row.original;
        if (!l.last_note) return <span className="text-faint">—</span>;
        return (
          <div className="max-w-[260px]">
            <div className="text-[12.5px] text-ink-2 truncate" title={l.last_note}>{l.last_note}</div>
            <div className="text-[11px] text-muted mt-0.5">{timeAgo(l.last_note_at)}</div>
          </div>
        );
      },
    },
    { id: 'updated_at', accessorKey: 'updated_at', header: '', cell: () => null },
  ], []);

  const table = useReactTable({
    data: segmented,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _id, value) => {
      const q = String(value).toLowerCase();
      const l = row.original;
      return l.full_name.toLowerCase().includes(q) || (l.phone || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.last_note || '').toLowerCase().includes(q) || (l.visa_type || '').toLowerCase().includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 }, columnVisibility: { updated_at: false } },
  });

  useEffect(() => {
    if (!stageMenu) return;
    const onClick = () => setStageMenu(null);
    setTimeout(() => window.addEventListener('click', onClick, { once: true }), 0);
    return () => window.removeEventListener('click', onClick);
  }, [stageMenu]);

  const segments: Segment[] = ['all', ...STAGE_ORDER];

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {segments.map((s) => {
          const meta = s === 'all' ? null : STAGE_META[s];
          const label = s === 'all' ? 'All' : meta!.label;
          return (
            <button key={s} onClick={() => setSegment(s)} className={cn('filter-chip', segment === s && 'active')}>
              {meta && <span className="chip-dot" style={{ background: meta.dot, marginRight: 4 }} />}{label}
              <span className="count">{counts[s]}</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, email…"
              className="pl-8 pr-3 py-2 text-[12.5px] w-[280px] rounded-md border border-border bg-surface focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft text-ink" />
          </div>
        </div>
      </div>

      {segmented.length === 0 ? (
        <div className="panel py-16 text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-surface-2"><Filter className="w-7 h-7 text-faint" /></div>
          <h3 className="text-[15px] font-semibold mb-1">No leads match this view</h3>
          <p className="text-[12.5px] text-muted mb-5">Try a different tag or import leads</p>
          <button onClick={() => setSegment('all')} className="btn btn-outline">Show all leads</button>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '65vh' }}>
            <table className="w-full" style={{ minWidth: 1100 }}>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const can = h.column.getCanSort();
                      const sort = h.column.getIsSorted();
                      return (
                        <th key={h.id} onClick={can ? h.column.getToggleSortingHandler() : undefined}
                          className={cn('text-[11px] font-semibold uppercase tracking-wider px-3.5 py-2.5 text-left text-muted bg-surface border-b border-border sticky top-0 z-[2] select-none', can && 'cursor-pointer hover:text-ink')}>
                          <span className="inline-flex items-center gap-1">{flexRender(h.column.columnDef.header, h.getContext())}
                            {sort === 'asc' && <ArrowUp className="w-3 h-3" />}{sort === 'desc' && <ArrowDown className="w-3 h-3" />}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} onClick={() => onRowClick(row.original.id)} className="border-b border-border hover:bg-surface-2 cursor-pointer transition-colors last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3.5 py-3.5 text-[13.5px] align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3.5 border-t border-border flex items-center justify-between text-[12px] text-muted flex-wrap gap-2">
            <div>Showing <span className="num font-semibold text-ink-2">{table.getRowModel().rows.length}</span> of <span className="num font-semibold text-ink-2">{segmented.length}</span></div>
            {table.getPageCount() > 1 && (
              <div className="flex items-center gap-1.5">
                <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} className="btn btn-ghost p-1.5 disabled:opacity-30">‹</button>
                <span className="num font-medium text-ink-2">{table.getState().pagination.pageIndex + 1} / {table.getPageCount()}</span>
                <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} className="btn btn-ghost p-1.5 disabled:opacity-30">›</button>
              </div>
            )}
          </div>
        </div>
      )}

      {stageMenu && (
        <div className="fixed z-[90] bg-surface border border-border rounded-md shadow-lg p-1 min-w-[180px] animate-fadeIn"
          style={{ left: stageMenu.x, top: stageMenu.y }} onClick={(e) => e.stopPropagation()}>
          {STAGE_ORDER.map((k) => {
            const s = STAGE_META[k];
            return (
              <button key={k} onClick={() => { updateLead(stageMenu.leadId, { stage: k }); setStageMenu(null); }}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink text-left">
                <span className="chip-dot" style={{ background: s.dot }} />{s.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
