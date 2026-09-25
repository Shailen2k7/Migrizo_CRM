'use client';

// The Leads page, plus the "CVs from WhatsApp" popup floating over it.
// A separate layout so the popup is added without touching the page itself.
import type { ReactNode } from 'react';
import { useUI } from '@/components/shared/app-shell';
import { CvInboxPopup } from '@/components/leads/cv-inbox-popup';

export default function LeadsLayout({ children }: { children: ReactNode }) {
  const ui = useUI();
  return (
    <>
      {children}
      <CvInboxPopup onOpenLead={(id) => ui.openLeadDrawer(id)} />
    </>
  );
}
