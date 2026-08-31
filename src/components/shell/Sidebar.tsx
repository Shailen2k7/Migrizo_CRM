"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileUp,
  ArrowLeftRight,
  Tags,
  Landmark,
  BookOpenText,
  RefreshCcw,
  LineChart,
  Sparkles,
  Settings,
  X,
  Building2,
  LogOut,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import { useLock } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase";
import { flushSync } from "@/lib/sync";
import { CloudBadge } from "@/components/auth/CloudPanel";
import { cn } from "@/components/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/import", label: "Import Statements", icon: FileUp },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/income-expenses", label: "Income & Expenses", icon: Tags },
  { href: "/loans", label: "Loans & Credit", icon: Landmark },
  { href: "/accounting", label: "Accounting", icon: BookOpenText },
  { href: "/recurring", label: "Recurring", icon: RefreshCcw },
  { href: "/analytics", label: "Analytics", icon: LineChart },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
];

export function Sidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const active = useStore((s) => s.activeBusiness);
  const setActive = useStore((s) => s.setActiveBusiness);
  const lock = useLock((s) => s.lock);
  const hasPassword = useLock((s) => !!s.hash);
  const lockCloud = useSession((s) => s.lock);

  const biz = BUSINESSES.find((b) => b.id === active) ?? BUSINESSES[0];
  const nav = NAV;

  const body = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 pb-5 pt-6">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-md text-primary-fg"
          style={{ background: `rgb(${biz.accent})` }}
        >
          <Building2 size={18} className="text-white" />
        </div>
        <div>
          <p className="text-[15px] font-bold leading-tight tracking-tight">Founder Finance OS</p>
          <p className="label-caps mt-0.5">Executive Portal</p>
        </div>
        <button
          className="ml-auto rounded-md p-1.5 text-text-3 hover:bg-surface-3 lg:hidden"
          onClick={onCloseMobile}
        >
          <X size={16} />
        </button>
      </div>

      {/* Business switcher */}
      <div className="mx-4 mb-5 rounded-md border border-border bg-surface-2 p-1">
          <div className="grid grid-cols-2 gap-1">
            {BUSINESSES.map((b) => (
              <button
                key={b.id}
                onClick={() => setActive(b.id)}
                className={cn(
                  "rounded px-3 py-2 text-[13px] font-semibold transition-all duration-200",
                  active === b.id
                    ? "bg-primary text-primary-fg shadow-card"
                    : "text-text-3 hover:text-text-2"
                )}
              >
                {b.name}
              </button>
            ))}
          </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onCloseMobile}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-all duration-150",
                isActive ? "bg-primary/10 text-text" : "text-text-2 hover:bg-surface-3/60 hover:text-text"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
              )}
              <Icon
                size={17}
                className={cn(
                  "transition-colors",
                  isActive ? "text-primary" : "text-text-3 group-hover:text-text-2"
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="space-y-0.5 border-t border-border px-3 py-4">
        <Link
          href="/settings"
          onClick={onCloseMobile}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-colors",
            pathname === "/settings"
              ? "bg-primary/10 text-text"
              : "text-text-2 hover:bg-surface-3/60 hover:text-text"
          )}
        >
          <Settings size={17} className="text-text-3" />
          Settings
        </Link>
        {supabaseConfigured ? (
          <button
            onClick={async () => {
              await flushSync();
              lockCloud();
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-text-2 transition-colors hover:bg-surface-3/60 hover:text-text"
          >
            <LogOut size={17} className="text-text-3" />
            Lock app
          </button>
        ) : (
          hasPassword && (
            <button
              onClick={lock}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-text-2 transition-colors hover:bg-surface-3/60 hover:text-text"
            >
              <LogOut size={17} className="text-text-3" />
              Lock app
            </button>
          )
        )}
        <div className="px-3 pt-2">
          <CloudBadge />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] border-r border-border bg-surface/70 backdrop-blur-xl lg:block">
        {body}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={onCloseMobile}
          />
          <aside className="absolute inset-y-0 left-0 w-[252px] border-r border-border bg-surface shadow-float animate-fade-in">
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
