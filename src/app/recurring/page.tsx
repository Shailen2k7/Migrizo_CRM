"use client";

import { useMemo, useState } from "react";
import { Pause, Pencil, Play, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useStore, allCategories } from "@/lib/store";
import { RecurringExpense } from "@/lib/types";
import { daysUntil, fmtDate, fmtINR, todayISO } from "@/lib/format";
import { Button, Card, Empty, Field, Input, Modal, Select, cn, toast } from "@/components/ui";
import { BUSINESSES } from "@/lib/seed";

export default function RecurringPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const recurring = useStore((s) => s.recurring).filter((r) => r.businessId === activeBusiness);
  const customCategories = useStore((s) => s.customCategories);
  const { addRecurring, updateRecurring, deleteRecurring } = useStore();
  const biz = BUSINESSES.find((b) => b.id === activeBusiness)!;
  const cats = allCategories(customCategories);

  const [modal, setModal] = useState<{ open: boolean; editing: RecurringExpense | null }>({ open: false, editing: null });

  const sorted = useMemo(() => [...recurring].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1)), [recurring]);

  const monthlyTotal = useMemo(
    () =>
      recurring
        .filter((r) => r.active)
        .reduce((s, r) => s + (r.cadence === "monthly" ? r.amount : r.cadence === "quarterly" ? r.amount / 3 : r.amount / 12), 0),
    [recurring]
  );
  const yearlyTotal = monthlyTotal * 12;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <p className="label-caps mb-1">{biz.name}</p>
          <h1 className="text-3xl font-bold tracking-tight">Recurring Expenses</h1>
          <p className="mt-1 text-sm text-text-3">
            Subscriptions, SaaS, rent, salaries — everything that hits your account on repeat.
          </p>
        </div>
        <Button variant="primary" onClick={() => setModal({ open: true, editing: null })}>
          <Plus size={15} /> Add Recurring
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4" hover={false}>
          <p className="label-caps">Monthly Commitment</p>
          <p className="num mt-1.5 text-2xl font-bold">{fmtINR(monthlyTotal)}</p>
          <p className="mt-1 text-xs text-text-3">{recurring.filter((r) => r.active).length} active subscriptions</p>
        </Card>
        <Card className="p-4" hover={false}>
          <p className="label-caps">Annualized</p>
          <p className="num mt-1.5 text-2xl font-bold text-warning">{fmtINR(yearlyTotal)}</p>
          <p className="mt-1 text-xs text-text-3">per year at current run-rate</p>
        </Card>
      </div>

      <Card className="p-0" hover={false}>
        {sorted.length === 0 ? (
          <Empty icon={<RefreshCcw size={26} />} title="No recurring expenses" sub="Track OpenAI, AWS, rent, salaries and other repeat payments." />
        ) : (
          <div className="divide-y divide-border/60">
            {sorted.map((r) => {
              const d = daysUntil(r.nextDate);
              return (
                <div key={r.id} className={cn("group flex items-center gap-4 px-5 py-3.5", !r.active && "opacity-45")}>
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-surface-3 text-sm font-bold text-text-2">
                    {r.vendor.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{r.name}</p>
                    <p className="text-xs text-text-3">
                      {r.vendor} · <span className="capitalize">{r.cadence}</span> · {r.category}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-xs text-text-3">Next charge</p>
                    <p className={cn("num text-[13px] font-semibold", r.active && d <= 5 && "text-warning")}>
                      {r.active ? `${fmtDate(r.nextDate)}${d >= 0 ? ` (${d}d)` : ""}` : "Paused"}
                    </p>
                  </div>
                  <p className="num w-28 text-right text-[15px] font-bold">{fmtINR(r.amount)}</p>
                  <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      title={r.active ? "Pause" : "Resume"}
                      onClick={() => { updateRecurring(r.id, { active: !r.active }); toast(r.active ? `${r.name} paused` : `${r.name} resumed`); }}
                      className="rounded p-1.5 text-text-3 hover:bg-surface-3 hover:text-text"
                    >
                      {r.active ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button title="Edit" onClick={() => setModal({ open: true, editing: r })} className="rounded p-1.5 text-text-3 hover:bg-surface-3 hover:text-text">
                      <Pencil size={14} />
                    </button>
                    <button title="Delete" onClick={() => { deleteRecurring(r.id); toast("Recurring expense removed"); }} className="rounded p-1.5 text-text-3 hover:bg-surface-3 hover:text-negative">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <RecurringModal
        state={modal}
        cats={cats}
        onClose={() => setModal({ open: false, editing: null })}
        onSave={(data, id) => {
          if (id) { updateRecurring(id, data); toast("Updated"); }
          else { addRecurring({ ...(data as Omit<RecurringExpense, "id" | "businessId">), businessId: activeBusiness }); toast("Recurring expense added"); }
        }}
      />
    </div>
  );
}

function RecurringModal({
  state,
  cats,
  onClose,
  onSave,
}: {
  state: { open: boolean; editing: RecurringExpense | null };
  cats: string[];
  onClose: () => void;
  onSave: (data: Partial<RecurringExpense>, id?: string) => void;
}) {
  const e = state.editing;
  const [f, setF] = useState<Record<string, string>>({});
  const key = e?.id ?? "new";
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (state.open && lastKey !== key) {
    setLastKey(key);
    setF({
      name: e?.name ?? "", vendor: e?.vendor ?? "", category: e?.category ?? "Subscription",
      amount: String(e?.amount ?? ""), cadence: e?.cadence ?? "monthly",
      nextDate: e?.nextDate ?? todayISO(), active: e?.active === false ? "no" : "yes",
    });
  }
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = () => {
    if (!f.name || !parseFloat(f.amount)) {
      toast("Name and amount are required.", "error");
      return;
    }
    onSave(
      {
        name: f.name, vendor: f.vendor || f.name, category: f.category,
        amount: parseFloat(f.amount), cadence: f.cadence as RecurringExpense["cadence"],
        nextDate: f.nextDate, active: f.active === "yes",
      },
      e?.id
    );
    onClose();
  };
  return (
    <Modal open={state.open} onClose={onClose} title={e ? "Edit Recurring Expense" : "Add Recurring Expense"}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name ?? ""} onChange={(ev) => set("name", ev.target.value)} placeholder="OpenAI Team" /></Field>
        <Field label="Vendor"><Input value={f.vendor ?? ""} onChange={(ev) => set("vendor", ev.target.value)} placeholder="OpenAI" /></Field>
        <Field label="Category">
          <Select value={f.category ?? ""} onChange={(ev) => set("category", ev.target.value)}>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Amount (₹)"><Input mono type="number" value={f.amount ?? ""} onChange={(ev) => set("amount", ev.target.value)} /></Field>
        <Field label="Billing Cycle">
          <Select value={f.cadence ?? "monthly"} onChange={(ev) => set("cadence", ev.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </Field>
        <Field label="Next Charge Date"><Input type="date" value={f.nextDate ?? ""} onChange={(ev) => set("nextDate", ev.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{e ? "Save" : "Add"}</Button>
      </div>
    </Modal>
  );
}
