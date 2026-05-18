'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const widths = { sm: 'max-w-[440px]', md: 'max-w-[560px]', lg: 'max-w-[920px]' };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-5"
          style={{ background: 'rgba(15, 17, 21, 0.45)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className={`bg-surface border border-border rounded-2xl shadow-lg w-full ${widths[size]} max-h-[90vh] flex flex-col`}
            initial={{ y: 12, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {(title || subtitle) && (
              <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-4">
                <div>
                  {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
                  {subtitle && <p className="text-[12.5px] text-muted mt-1">{subtitle}</p>}
                </div>
                <button onClick={onClose} className="p-1.5 -mt-1 -mr-1 rounded-md hover:bg-surface-2 text-muted hover:text-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="px-6 py-4 border-t border-border bg-surface-2 flex items-center justify-end gap-2 rounded-b-2xl">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
