"use client";

import { useMemo, useRef, useState } from "react";
import { Bell, Menu, Moon, Search, Sun } from "lucide-react";
import { useStore } from "@/lib/store";
import { buildNotifications, computeKPIs, forBusiness } from "@/lib/metrics";
import { cn } from "@/components/ui";
import { fmtDateShort } from "@/lib/format";
import { useOnClickOutside } from "./useOnClickOutside";

export function Topbar({
  onOpenPalette,
  onOpenMobileNav,
}: {
  onOpenPalette: () => void;
  onOpenMobileNav: () => void;
}) {
  const { theme, setTheme, activeBusiness, readNotifications, markNotificationsRead } =
    useStore();
  const transactions = useStore((s) => s.transactions);
  const loans = useStore((s) => s.loans);
  const cards = useStore((s) => s.cards);
  const invoices = useStore((s) => s.invoices);
  const recurring = useStore((s) => s.recurring);
  const openingBalances = useStore((s) => s.openingBalances);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(notifRef, () => setNotifOpen(false));

  const notifications = useMemo(() => {
    const txns = forBusiness(transactions, activeBusiness);
    const bl = loans.filter((l) => l.businessId === activeBusiness);
    const bc = cards.filter((c) => c.businessId === activeBusiness);
    const bi = invoices.filter((i) => i.businessId === activeBusiness);
    const br = recurring.filter((r) => r.businessId === activeBusiness);
    const kpis = computeKPIs(txns, bl, bc, bi, br, openingBalances[activeBusiness]);
    return buildNotifications(activeBusiness, txns, bl, bc, bi, br, kpis);
  }, [transactions, loans, cards, invoices, recurring, activeBusiness, openingBalances]);

  const unread = notifications.filter((n) => !readNotifications.includes(n.id));

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-5 lg:px-8">
        <button
          className="rounded-md p-2 text-text-2 hover:bg-surface-3 lg:hidden"
          onClick={onOpenMobileNav}
        >
          <Menu size={18} />
        </button>

        {/* Global search trigger */}
        <button
          onClick={onOpenPalette}
          className="flex h-9 w-full max-w-md items-center gap-2.5 rounded-md border border-border bg-surface-2/80 px-3 text-sm text-text-3 transition-colors hover:border-border-strong"
        >
          <Search size={15} />
          <span className="flex-1 text-left">
            Search transactions, vendors, reports…
          </span>
          <kbd className="hidden rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold sm:block">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-2 text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen((o) => !o)}
              className="relative rounded-md p-2 text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
            >
              <Bell size={17} />
              {unread.length > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[9px] font-bold text-white">
                  {unread.length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-12 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-strong/40 shadow-float animate-scale-in"
                style={{ background: "var(--glass-bg)", backdropFilter: "blur(32px)" }}
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Notifications</p>
                  {unread.length > 0 && (
                    <button
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => markNotificationsRead(notifications.map((n) => n.id))}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-text-3">
                      All clear. No alerts right now.
                    </p>
                  )}
                  {notifications.map((n) => {
                    const isRead = readNotifications.includes(n.id);
                    return (
                      <div
                        key={n.id}
                        className={cn(
                          "flex gap-3 border-b border-border/50 px-4 py-3 last:border-0",
                          !isRead && "bg-primary/[0.04]"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 flex-none rounded-full",
                            n.severity === "critical" && "bg-negative",
                            n.severity === "warning" && "bg-warning",
                            n.severity === "info" && "bg-chart-2"
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold leading-snug">{n.title}</p>
                          <p className="mt-0.5 text-xs text-text-3">{n.body}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-text-3">
                            {fmtDateShort(n.date)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
