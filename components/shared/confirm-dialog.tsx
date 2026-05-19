'use client';

import { Modal } from '@/components/shared/modal';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  busy?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger', busy = false }: Props) {
  const iconBg = variant === 'danger' ? '#FEE2E2' : variant === 'warning' ? '#FEF3C7' : '#DBEAFE';
  const iconColor = variant === 'danger' ? '#B91C1C' : variant === 'warning' ? '#B45309' : '#1E40AF';
  const btnClass = variant === 'danger' ? 'btn-danger' : 'btn-primary';

  return (
    <Modal open={open} onClose={onClose} size="sm" title={title}
      footer={<>
        <button onClick={onClose} className="btn btn-ghost" disabled={busy}>{cancelLabel}</button>
        <button onClick={onConfirm} className={`btn ${btnClass} disabled:opacity-50`} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </>}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
          <AlertTriangle className="w-4.5 h-4.5" style={{ color: iconColor }} />
        </div>
        {description && <p className="text-[13px] text-ink-2 leading-relaxed pt-1.5">{description}</p>}
      </div>
    </Modal>
  );
}
