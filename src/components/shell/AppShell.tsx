"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { Toaster } from "@/components/ui";
import { AuthGate } from "@/components/auth/AuthGate";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppFrame>{children}</AppFrame>
    </AuthGate>
  );
}

function AppFrame({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  return (
    <div className="app-bg min-h-screen">
      <Sidebar mobileOpen={mobileNav} onCloseMobile={() => setMobileNav(false)} />
      <div className="lg:pl-[252px] flex min-h-screen flex-col">
        <Topbar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenMobileNav={() => setMobileNav(true)}
        />
        <main className="flex-1 px-5 py-6 lg:px-8">
          {hydrated ? (
            children
          ) : (
            <div className="space-y-4 pt-2">
              <div className="skeleton h-8 w-64 rounded-md" />
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton h-32 rounded-lg" />
                ))}
              </div>
              <div className="skeleton h-80 rounded-lg" />
            </div>
          )}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
}
