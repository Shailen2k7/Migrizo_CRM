'use client';

// =============================================================================
// MESSAGE BUBBLE — one message, shared by the inbox and the pop-out window.
//
// Lives in its own file so both surfaces render messages identically. If the
// bubble changes, it changes in both places, which is the whole point.
//
// Media is fetched through /api/whatsapp/media/<id>, never from a public URL —
// the bucket is private and these are CVs and passports.
// =============================================================================
import { Check, CheckCheck, Clock, AlertCircle, Zap, FileText, Download, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WaMessage, WaStatus } from '@/lib/whatsapp/types';

export function fmtTime(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ap}`;
}

export function StatusTick({ status }: { status: WaStatus }) {
  if (status === 'queued') return <Clock className="h-[13px] w-[13px] text-[#A8ADBF]" />;
  if (status === 'failed') return <AlertCircle className="h-[13px] w-[13px] text-[#B02B2B]" />;
  if (status === 'read') return <CheckCheck className="h-[14px] w-[14px] text-[#25A25A]" />;
  if (status === 'delivered') return <CheckCheck className="h-[14px] w-[14px] text-[#A8ADBF]" />;
  return <Check className="h-[13px] w-[13px] text-[#A8ADBF]" />;
}

function prettySize(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The attachment, rendered by kind. Optimistic rows have no id yet. */
function Media({ m, out }: { m: WaMessage; out: boolean }) {
  const pending = m.id.startsWith('tmp_');
  const src = pending ? null : `/api/whatsapp/media/${m.id}`;

  if (m.media_type === 'image') {
    return (
      <div className="mb-1.5 overflow-hidden rounded-[10px]">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={src} target="_blank" rel="noreferrer">
            <img
              src={src}
              alt={m.media_name || 'Photo'}
              loading="lazy"
              className="block max-h-[320px] w-auto max-w-full cursor-zoom-in object-cover"
            />
          </a>
        ) : (
          <div className="flex h-[140px] w-[220px] items-center justify-center bg-black/5 text-[11.5px] text-[#7A8095]">
            Uploading…
          </div>
        )}
      </div>
    );
  }

  if (m.media_type === 'audio') {
    return (
      <div className="mb-1.5">
        {src ? (
          <audio controls preload="none" src={src} className="h-[38px] w-[240px] max-w-full" />
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-[#7A8095]"><Play className="h-3.5 w-3.5" /> Uploading…</div>
        )}
      </div>
    );
  }

  if (m.media_type === 'video') {
    return (
      <div className="mb-1.5 overflow-hidden rounded-[10px]">
        {src ? (
          <video controls preload="metadata" src={src} className="block max-h-[300px] w-auto max-w-full" />
        ) : (
          <div className="flex h-[140px] w-[220px] items-center justify-center bg-black/5 text-[11.5px] text-[#7A8095]">Uploading…</div>
        )}
      </div>
    );
  }

  // Documents — the common case here, since leads send CVs.
  return (
    <a
      href={src ? `${src}?download=1` : undefined}
      className={cn(
        'mb-1.5 flex items-center gap-[10px] rounded-[10px] border px-3 py-2.5 transition',
        out ? 'border-black/10 bg-white/60 hover:bg-white' : 'border-[#E8EAF0] bg-[#F7F8FA] hover:bg-[#F0F1F5]',
        !src && 'pointer-events-none opacity-60'
      )}
    >
      <span className={cn(
        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px]',
        out ? 'bg-[#25A25A]/15 text-[#12331F]' : 'bg-[#E9EDFF] text-[#3323cc]'
      )}>
        <FileText className="h-[17px] w-[17px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.8px] font-semibold">{m.media_name || 'Document'}</span>
        <span className="block text-[11px] opacity-70">
          {pending ? 'Uploading…' : prettySize(m.media_size) || 'Document'}
        </span>
      </span>
      {src && <Download className="h-[15px] w-[15px] flex-shrink-0 opacity-55" />}
    </a>
  );
}

export function MessageBubble({ m, last }: { m: WaMessage; last: boolean }) {
  const out = m.direction === 'out';
  const bad = m.status === 'failed';
  const hasMedia = Boolean(m.media_type);
  // An image with no caption shouldn't sit inside a padded text bubble.
  const bare = hasMedia && !m.body?.trim() && (m.media_type === 'image' || m.media_type === 'video');

  return (
    <>
      <div className={cn(
        'max-w-[min(80%,560px)]',
        bare ? 'overflow-hidden p-0' : 'px-4 py-2.5',
        out
          ? cn('rounded-t-xl rounded-bl-xl rounded-br-sm shadow-[0_1px_2px_rgba(20,24,40,.03)]',
               bad ? 'bg-[#FEEFEF] text-[#5A1919] ring-1 ring-[rgba(232,85,85,.3)]' : 'bg-[#DCF6D4] text-[#12331F]')
          : 'rounded-t-xl rounded-bl-sm rounded-br-xl border border-[#E8EAF0] bg-white text-[#1F2733] shadow-[0_1px_2px_rgba(20,24,40,.04)]',
        bare && 'rounded-[14px] border-0 bg-transparent shadow-none ring-0'
      )}>
        {m.template_code && (
          <div className="mb-1.5 flex items-center gap-2">
            <span
              title={m.template_code}
              className="inline-flex items-center gap-1 rounded-[4px] border border-[#BDE8CD] bg-[#E2F5EA] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#119751]"
            >
              <Zap className="h-[9px] w-[9px]" />
              {m.template_category || 'Template'}
            </span>
          </div>
        )}

        {hasMedia && <Media m={m} out={out} />}

        {m.body?.trim() && (
          <p className={cn('m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed', bare && 'px-1')}>
            {m.body}
          </p>
        )}

        {bad && (
          <div className="mt-2 flex items-start gap-1.5 border-t border-[rgba(232,85,85,.25)] pt-2 text-[11.5px] text-[#B02B2B]">
            <AlertCircle className="mt-px h-3 w-3 flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <b className="font-bold">Not delivered.</b> {m.error_detail || m.error_code || 'Unknown error'}
            </span>
          </div>
        )}
      </div>

      {last && (
        <span className={cn('flex items-center gap-1 text-[11px] text-[#7A8095]', out ? 'mr-1' : 'ml-1')}>
          {fmtTime(m.created_at)}
          {out && <StatusTick status={m.status} />}
        </span>
      )}
    </>
  );
}
