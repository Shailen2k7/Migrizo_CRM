'use client';

import type { Lead, Currency } from '@/lib/types';
import { formatMoney } from '@/lib/utils';

// =============================================================================
// DEAL TAG — a small pill next to a lead's name showing the agreed deal amount.
// If a discount was applied, it turns green and a hover tooltip breaks down
// the original deal, the discount, and the final payable amount.
// Pure CSS tooltip (no JS) so it works inside tables and pipeline cards alike.
// =============================================================================
export function DealTag({ lead, size = 'sm' }: { lead: Pick<Lead, 'amount_total' | 'discount' | 'currency'>; size?: 'sm' | 'md' }) {
  const total = Number(lead.amount_total || 0);
  const discount = Number(lead.discount || 0);
  if (total <= 0 && discount <= 0) return null;

  const currency = (lead.currency as Currency) || 'GBP';
  const original = total + discount;
  const discounted = discount > 0;

  const pad = size === 'md' ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[10.5px]';
  const bg = discounted ? '#E6F7EE' : '#EEF2FF';
  const fg = discounted ? '#047857' : '#3E56D4';
  const border = discounted ? '#A7E3C6' : '#C7D0F0';

  return (
    <span className="dealtag-wrap" style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        className={`dealtag inline-flex items-center gap-1 rounded-full font-bold ${pad}`}
        style={{ background: bg, color: fg, border: `1px solid ${border}`, cursor: 'default', whiteSpace: 'nowrap' }}
      >
        {discounted ? '🏷️' : '💷'} {formatMoney(total, currency)}
        {discounted && <span style={{ fontWeight: 700, opacity: 0.85 }}>· deal</span>}
      </span>
      {/* Hover tooltip */}
      <span
        className="dealtag-pop"
        style={{
          position: 'absolute', bottom: '130%', left: '50%', transform: 'translateX(-50%)',
          background: '#16294E', color: '#fff', borderRadius: 10, padding: '9px 12px',
          fontSize: 11.5, lineHeight: 1.6, width: 168, boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
          opacity: 0, visibility: 'hidden', transition: 'opacity .14s', zIndex: 60, pointerEvents: 'none',
          fontWeight: 500,
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#AEBEE0' }}>Deal</span><b>{formatMoney(original, currency)}</b></span>
        {discounted && <span style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#7EE0B0' }}>Discount</span><b style={{ color: '#7EE0B0' }}>− {formatMoney(discount, currency)}</b></span>}
        <span style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #2C446E', marginTop: 4, paddingTop: 4 }}><span style={{ color: '#AEBEE0' }}>Final</span><b style={{ color: '#F4C430' }}>{formatMoney(total, currency)}</b></span>
      </span>
    </span>
  );
}
