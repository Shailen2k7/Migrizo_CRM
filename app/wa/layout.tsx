// =============================================================================
// POP-OUT LAYOUT — deliberately outside the (app) group.
//
// No sidebar, no banners, no app chrome: a double-clicked conversation should
// open as a clean chat window you can park on a second monitor. Middleware
// still protects /wa, so this is authenticated like every other page.
// =============================================================================
import { Toaster } from 'sonner';

export const metadata = { title: 'Migrizo — Chat' };

export default function PopoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#EEF0F4]">
      {children}
      <Toaster position="bottom-center" richColors closeButton={false} />
    </div>
  );
}
