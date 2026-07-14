'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState
} from '@tanstack/react-table';
import { ChevronDown, Phone, Mail, ArrowUp, ArrowDown, Filter, Search, Star, Copy, Check } from 'lucide-react';
import { DealTag } from '@/components/shared/deal-tag';
import { useApp } from '@/components/shared/app-provider';
import type { Lead, LeadStage } from '@/lib/types';
import { STAGE_META, STAGE_ORDER, PAYMENT_META, getStageMeta, getVisaMeta } from '@/lib/types';
import { initials, avatarColor, formatMoney, scoreColor, timeAgo, cn } from '@/lib/utils';
import { IndustryChip } from '@/components/shared/industry-chip';

// Small copy-to-clipboard button with tick feedback
function CopyBtn({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* noop */ } }}
      title={`Copy ${label}`}
      className="flex-shrink-0 p-1 rounded hover:bg-white/15 transition-colors"
    >
      {done ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3 opacity-70 hover:opacity-100" />}
    </button>
  );
}

// Beautiful visa-type tag (GTV / IFV)
function VisaTag({ visa }: { visa: string | null }) {
  const m = getVisaMeta(visa);
  if (!m) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide" style={{ background: m.bg, color: m.fg }} title={m.full}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.short}
    </span>
  );
}

type Segment = 'all' | 'spotlight' | LeadStage;

interface Props {
  initialSegment?: Segment;
  onRowClick: (id: string) => void;
}

export function LeadsTable({ initialSegment = 'all', onRowClick }: Props) {
  const { leads, updateLead, toggleSpotlight } = useApp();
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updated_at', desc: true }]);
  const [stageMenu, setStageMenu] = useState<{ leadId: string; x: number; y: number } | null>(null);

  useEffect(() => setSegment(initialSegment), [initialSegment]);

  const segmented = useMemo(() => {
    if (segment === 'all') return leads;
    if (segment === 'spotlight') return leads.filter((l) => l.is_spotlight);
    return leads.filter((l) => l.stage === segment);
  }, [leads, segment]);

  const counts = useMemo(() => {
    const c: Record<Segment, number> = {
      all: leads.length, spotlight: 0, hot: 0, cold: 0, mr_coming_soon: 0, invoice_sent: 0, won: 0, junk: 0,
    };
    leads.forEach((l) => { c[l.stage] = (c[l.stage] || 0) + 1; if (l.is_spotlight) c.spotlight += 1; });
    return c;
  }, [leads]);

  const columns = useMemo<ColumnDef<Lead>[]>(() => [
    {
      id: 'name', accessorKey: 'full_name', header: 'Client',
      cell: ({ row }) => {
        const l = row.original;
        return (
          <div className="flex items-center gap-2.5 group relative">
            <button
              onClick={(e) => { e.stopPropagation(); toggleSpotlight(l.id); }}
              title={l.is_spotlight ? 'Remove from Spotlight' : 'Add to Spotlight'}
              className={cn('flex-shrink-0 p-0.5 rounded transition-colors', l.is_spotlight ? '' : 'opacity-0 group-hover:opacity-100')}
            >
              <Star className="w-3.5 h-3.5 transition-colors" style={l.is_spotlight ? { fill: '#F59E0B', color: '#F59E0B' } : { color: '#9CA3AF' }} />
            </button>
            <div className="av" style={{ background: avatarColor(l.id) }}>{initials(l.full_name)}</div>
            <div className="min-w-0">
              <div className="font-semibold text-ink leading-tight text-[13.5px]">{l.full_name}</div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <VisaTag visa={l.visa_type} />
                {l.industry && <IndustryChip industry={l.industry} size="xs" />}
                <DealTag lead={l} />
              </div>
            </div>
            {(l.phone || l.email) && (
              <div className="absolute left-0 -top-2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity bg-ink text-surface px-3 py-2 rounded-md text-[11.5px] whitespace-nowrap z-30 shadow-lg">
                {l.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{l.phone}<CopyBtn value={l.phone} label="phone" /></div>}
                {l.email && <div className="flex items-center gap-1.5 mt-0.5"><Mail className="w-3 h-3" />{l.email}<CopyBtn value={l.email} label="email" /></div>}
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
        const l = row.original; const s = getStageMeta(l.stage);
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
      cell: ({ row }) => { const a = row.original.amount_paid; return <span className={cn('num text-[13px] font-semibold', a ? 'text-ink' : 'text-faint')}>{a ? formatMoney(a, row.original.currency) : '—'}</span>; },
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
  ], [toggleSpotlight, updateLead]);

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

  const segments: ('all' | LeadStage)[] = ['all', ...STAGE_ORDER.filter((s) => s !== 'mr_coming_soon')];

  return (
    <>
      <div className="mb-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        {/* chips — horizontal scroll on mobile, wrap on desktop */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5 sm:pb-0 sm:flex-wrap sm:contents">
        <button
          onClick={() => setSegment('spotlight')}
          className={cn('filter-chip', segment === 'spotlight' && 'active')}
          style={segment === 'spotlight'
            ? { background: '#F59E0B', color: '#fff', borderColor: '#F59E0B' }
            : { background: '#FEF6E7', color: '#854F0B', borderColor: '#F3D9A4' }}
        >
          <Star className="w-3 h-3" style={{ fill: 'currentColor', marginRight: 4 }} />Spotlight
          <span className="count" style={segment === 'spotlight' ? { background: 'rgba(255,255,255,0.25)', color: '#fff' } : undefined}>{counts.spotlight}</span>
        </button>
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
        </div>
        <div className="sm:ml-auto flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email…"
              className="pl-8 pr-3 py-2 text-[12.5px] w-full sm:w-[280px] rounded-md border border-border bg-surface focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft text-ink" />
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
