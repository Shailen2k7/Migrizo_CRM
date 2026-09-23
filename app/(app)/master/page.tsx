'use client';

// =============================================================================
// MASTER LEADS — the page shell.
// -----------------------------------------------------------------------------
// Deliberately almost nothing. Every lead is already in the app provider's
// memory, loaded once when the CRM opens, so this page fetches nothing and adds
// no API route.
//
// IT IS ALSO FULL BLEED ON PURPOSE. Every other page in the CRM is a document
// centred in a 1480px column, which is right for a dashboard you read. A sheet
// is not read, it is worked in, and capping it threw away the screen space the
// extra columns needed. The heading, the counts and the toolbar all live inside
// the sheet component so it can measure its own height and take over the whole
// window when asked.
// =============================================================================

import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { MasterLeadsTable } from '@/components/master/master-leads-table';

export default function MasterLeadsPage() {
  const ui = useUI();
  useApp();                                    // asserts the provider is present

  return (
    <div className="animate-pageIn px-3 pb-3 pt-3 sm:px-5 sm:pt-4">
      <MasterLeadsTable onRowClick={ui.openLeadDrawer} />
    </div>
  );
}
