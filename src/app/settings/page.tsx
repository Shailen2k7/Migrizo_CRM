"use client";

import { useState } from "react";
import { AlertTriangle, Layers, Moon, Plus, RotateCcw, Shield, Sun, Tags, Trash2, Users, Wallet, X } from "lucide-react";
import { useStore, allCategories } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import { DEFAULT_CATEGORIES } from "@/lib/types";
import { Badge, Button, Card, Field, Input, cn, toast } from "@/components/ui";
import { MasterPasswordPanel } from "@/components/auth/MasterPasswordPanel";
import { CloudPanel } from "@/components/auth/CloudPanel";
import { supabaseConfigured } from "@/lib/supabase";

export default function SettingsPage() {
  const { theme, setTheme, customCategories, addCustomCategory, resetDemoData, openingBalances, setOpeningBalance, cogsCategories, setCogsCategories, relatedParties, setRelatedParties, clearAllData } = useStore();
  const transactions = useStore((s) => s.transactions);
  const [newCat, setNewCat] = useState("");
  const [newParty, setNewParty] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipeText, setWipeText] = useState("");

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <div className="animate-fade-up">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      </div>

      <CloudPanel />

      {!supabaseConfigured && <MasterPasswordPanel />}

      {/* Appearance */}
      <Card className="p-6" hover={false}>
        <h2 className="mb-4 text-sm font-semibold">Appearance</h2>
        <div className="flex gap-3">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold capitalize transition-all",
                theme === t
                  ? "border-primary/60 bg-primary/10 text-text"
                  : "border-border bg-surface-2 text-text-3 hover:text-text"
              )}
            >
              {t === "dark" ? <Moon size={15} /> : <Sun size={15} />}
              {t} mode
            </button>
          ))}
        </div>
      </Card>

      {/* Workspaces */}
      <Card className="p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Wallet size={15} className="text-text-3" /> Workspaces
        </h2>
        <p className="mb-4 text-xs text-text-3">
          Separate books for each business — no data mixing. Opening balances anchor bank balance
          calculations.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {BUSINESSES.map((b) => (
            <div key={b.id} className="rounded-md border border-border bg-surface-2/60 p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{b.name}</p>
                <Badge tone="info">{transactions.filter((t) => t.businessId === b.id).length} txns</Badge>
              </div>
              <label className="mt-3 block">
                <span className="label-caps mb-1 block">Opening balance (₹)</span>
                <Input
                  mono
                  type="number"
                  value={openingBalances[b.id]}
                  onChange={(e) => setOpeningBalance(b.id, Number(e.target.value) || 0)}
                  className="h-8"
                />
              </label>
            </div>
          ))}
        </div>
      </Card>

      {/* Categories */}
      <Card className="p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Tags size={15} className="text-text-3" /> Categories
        </h2>
        <p className="mb-4 text-xs text-text-3">
          {DEFAULT_CATEGORIES.length} built-in categories, plus your custom ones. AI remembers your
          corrections and applies them to future imports automatically.
        </p>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {DEFAULT_CATEGORIES.map((c) => (
            <Badge key={c} tone="neutral">{c}</Badge>
          ))}
          {customCategories.map((c) => (
            <Badge key={c} tone="info">{c}</Badge>
          ))}
        </div>
        <form
          className="flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCat.trim()) {
              addCustomCategory(newCat.trim());
              toast(`Category "${newCat.trim()}" added`);
              setNewCat("");
            }
          }}
        >
          <Input placeholder="New custom category…" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <Button variant="primary" type="submit"><Plus size={14} /> Add</Button>
        </form>
      </Card>

      {/* Related parties */}
      <Card className="p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Users size={15} className="text-text-3" /> Related Parties
        </h2>
        <p className="mb-4 text-xs text-text-3">
          Your own accounts, sister companies and family. Money arriving from
          these names is capital or an inter-company loan — never revenue,
          however large it is. Add the personal and family account names that
          appear in your statements; only you know which they are.
        </p>
        <div className="space-y-4">
          {BUSINESSES.map((b) => {
            const names = relatedParties[b.id] ?? [];
            return (
              <div key={b.id} className="rounded-md border border-border bg-surface-2/60 p-4">
                <p className="mb-2 font-semibold">{b.name}</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {names.map((n) => (
                    <span
                      key={n}
                      className="group inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-semibold text-text-2"
                    >
                      {n}
                      <button
                        onClick={() => setRelatedParties(b.id, names.filter((x) => x !== n))}
                        className="text-text-3 transition-colors hover:text-negative"
                        title={`Remove ${n}`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {names.length === 0 && (
                    <span className="text-[12px] text-text-3">None yet.</span>
                  )}
                </div>
                <form
                  className="flex max-w-sm gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = (newParty[b.id] ?? "").trim();
                    if (!v || names.some((n) => n.toLowerCase() === v.toLowerCase())) return;
                    setRelatedParties(b.id, [...names, v]);
                    setNewParty((s) => ({ ...s, [b.id]: "" }));
                    toast(`"${v}" marked as a related party`);
                  }}
                >
                  <Input
                    placeholder="Name as it appears in statements…"
                    value={newParty[b.id] ?? ""}
                    onChange={(e) => setNewParty((s) => ({ ...s, [b.id]: e.target.value }))}
                    className="h-8"
                  />
                  <Button size="sm" variant="secondary" type="submit">
                    <Plus size={13} /> Add
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-text-3">
          After changing this list, use <span className="font-semibold">Re-classify</span> on the
          Income &amp; Expenses page to apply it to existing transactions.
        </p>
      </Card>

      {/* Gross Profit / COGS */}
      <Card className="p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Layers size={15} className="text-text-3" /> Gross Profit — Cost of Goods (COGS)
        </h2>
        <p className="mb-4 text-xs text-text-3">
          Gross Profit = Revenue minus whichever categories you mark as direct
          cost of delivering it. Pick nothing and Gross Profit will equal
          Revenue exactly — that&apos;s not a bug, it means no spend is
          currently flagged as a direct cost. What counts differs by business:
          a consultancy&apos;s direct cost is usually vendor/professional
          payments; a software product&apos;s is usually hosting and API
          costs, which often land under &ldquo;Software&rdquo; or
          &ldquo;Subscription&rdquo;.
        </p>
        <div className="space-y-4">
          {BUSINESSES.map((b) => {
            const selected = cogsCategories[b.id] ?? [];
            const cats = allCategories(customCategories);
            return (
              <div key={b.id} className="rounded-md border border-border bg-surface-2/60 p-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="font-semibold">{b.name}</p>
                  <Badge tone={selected.length > 0 ? "info" : "warning"}>
                    {selected.length} categor{selected.length === 1 ? "y" : "ies"} counted
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cats.map((c) => {
                    const on = selected.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() =>
                          setCogsCategories(
                            b.id,
                            on ? selected.filter((x) => x !== c) : [...selected, c]
                          )
                        }
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
                          on
                            ? "bg-primary text-primary-fg"
                            : "border border-border bg-surface-3/50 text-text-3 hover:text-text-2"
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Security */}
      <Card className="p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Shield size={15} className="text-text-3" /> Security & Data
        </h2>
        <ul className="mb-4 space-y-1.5 text-[13px] text-text-2">
          <li>• All data is stored locally in your browser in this demo build — nothing leaves your machine.</li>
          <li>• Every transaction edit is recorded in an immutable audit history.</li>
          <li>• Production deployment adds Supabase auth, Postgres row-level security, encrypted backups and role-based access.</li>
        </ul>
        {!confirmReset ? (
          <Button variant="secondary" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={14} /> Restore demo data
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-2">Replace everything with the demo dataset?</span>
            <Button variant="danger" onClick={() => { resetDemoData(); setConfirmReset(false); toast("Demo data restored"); }}>
              Yes, restore
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}><X size={14} /> Cancel</Button>
          </div>
        )}
      </Card>

      {/* Danger zone */}
      <Card className="border-negative/25 p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-negative">
          <AlertTriangle size={15} /> Danger Zone
        </h2>
        <p className="mb-4 text-xs text-text-3">
          Delete <span className="font-semibold text-text-2">everything</span> — all transactions,
          statements, card charges, loans, cards, recurring expenses, import history,
          learned categories and opening balances, for both Migrizo and Nutrolis. Use this to start
          fresh and upload your real bank &amp; credit-card statements.
        </p>
        {!confirmWipe ? (
          <Button variant="danger" onClick={() => setConfirmWipe(true)}>
            <Trash2 size={14} /> Delete ALL data
          </Button>
        ) : (
          <div className="max-w-md space-y-3 rounded-md border border-negative/30 bg-negative/5 p-4">
            <p className="text-sm font-semibold text-negative">
              This permanently erases every record in this browser. There is no undo.
            </p>
            <Field label={'Type DELETE to confirm'}>
              <Input
                value={wipeText}
                onChange={(e) => setWipeText(e.target.value)}
                placeholder="DELETE"
                autoFocus
              />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={wipeText !== "DELETE"}
                onClick={() => {
                  clearAllData();
                  setConfirmWipe(false);
                  setWipeText("");
                  toast("All data deleted — you have a clean slate", "info");
                }}
              >
                <Trash2 size={14} /> Permanently delete everything
              </Button>
              <Button variant="ghost" onClick={() => { setConfirmWipe(false); setWipeText(""); }}>
                <X size={14} /> Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
