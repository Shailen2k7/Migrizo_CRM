"use client";

import { useMemo, useState } from "react";
import { Banknote, CalendarClock, CreditCard as CardIcon, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { CreditCard, Loan } from "@/lib/types";
import { daysUntil, fmtDate, fmtINR, todayISO } from "@/lib/format";
import { Badge, Button, Card, Empty, Field, Input, Modal, Progress, Select, cn, toast } from "@/components/ui";
import { BUSINESSES } from "@/lib/seed";

export default function LoansPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const loans = useStore((s) => s.loans).filter((l) => l.businessId === activeBusiness);
  const cards = useStore((s) => s.cards).filter((c) => c.businessId === activeBusiness);
  const { addLoan, updateLoan, deleteLoan, addCard, updateCard, deleteCard } = useStore();
  const biz = BUSINESSES.find((b) => b.id === activeBusiness)!;

  const [loanModal, setLoanModal] = useState<{ open: boolean; editing: Loan | null }>({ open: false, editing: null });
  const [cardModal, setCardModal] = useState<{ open: boolean; editing: CreditCard | null }>({ open: false, editing: null });

  const totals = useMemo(() => ({
    loanOutstanding: loans.reduce((s, l) => s + l.outstanding, 0),
    emiMonthly: loans.reduce((s, l) => s + l.emi, 0),
    cardOutstanding: cards.reduce((s, c) => s + c.outstanding, 0),
    cardLimit: cards.reduce((s, c) => s + c.limit, 0),
  }), [loans, cards]);

  const upcoming = useMemo(() => {
    const items: { date: string; label: string; amount: number; kind: "emi" | "card" }[] = [
      ...loans.map((l) => ({ date: l.nextDueDate, label: `${l.name} EMI — ${l.lender}`, amount: l.emi, kind: "emi" as const })),
      ...cards.map((c) => ({ date: c.dueDate, label: `${c.name} ····${c.last4}`, amount: c.totalDue, kind: "card" as const })),
    ];
    return items.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [loans, cards]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <p className="label-caps mb-1">{biz.name}</p>
          <h1 className="text-3xl font-bold tracking-tight">Debt & Credit</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCardModal({ open: true, editing: null })}>
            <Plus size={14} /> Credit Card
          </Button>
          <Button variant="primary" onClick={() => setLoanModal({ open: true, editing: null })}>
            <Plus size={14} /> Loan
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard icon={<Landmark size={15} />} label="Loan Outstanding" value={fmtINR(totals.loanOutstanding)} />
        <SummaryCard icon={<Banknote size={15} />} label="Monthly EMIs" value={fmtINR(totals.emiMonthly)} />
        <SummaryCard icon={<CardIcon size={15} />} label="Card Outstanding" value={fmtINR(totals.cardOutstanding)} />
        <SummaryCard
          icon={<CalendarClock size={15} />}
          label="Card Utilization"
          value={totals.cardLimit ? `${Math.round((totals.cardOutstanding / totals.cardLimit) * 100)}%` : "0%"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Loans */}
          <h2 className="px-1 text-base font-semibold">Active Loans</h2>
          {loans.length === 0 && (
            <Card hover={false}><Empty title="No loans tracked" sub="Add business or personal loans to monitor EMIs and outstanding balances." /></Card>
          )}
          {loans.map((l) => {
            const paidPct = l.principal > 0 ? 1 - l.outstanding / l.principal : 0;
            const due = daysUntil(l.nextDueDate);
            return (
              <Card key={l.id} className="group p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-semibold">{l.name}</h3>
                      <Badge tone={l.kind === "business" ? "info" : "gold"}>{l.kind}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-3">
                      {l.lender} · {l.interestRate}% p.a. · {l.paidMonths}/{l.tenureMonths} months paid
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => setLoanModal({ open: true, editing: l })}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { deleteLoan(l.id); toast("Loan removed"); }}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                <p className="num mt-3 text-2xl font-bold">{fmtINR(l.outstanding)}</p>
                <p className="text-xs text-text-3">outstanding of {fmtINR(l.principal)}</p>
                <Progress value={paidPct} tone="primary" className="mt-3" />
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-center">
                  <div>
                    <p className="label-caps">Next EMI</p>
                    <p className="num mt-1 text-sm font-semibold">{fmtINR(l.emi)}</p>
                  </div>
                  <div>
                    <p className="label-caps">Due Date</p>
                    <p className={cn("num mt-1 text-sm font-semibold", due <= 5 && "text-warning")}>
                      {fmtDate(l.nextDueDate)}
                    </p>
                  </div>
                  <div>
                    <p className="label-caps">Interest / mo (approx)</p>
                    <p className="num mt-1 text-sm font-semibold text-negative">
                      {fmtINR((l.outstanding * l.interestRate) / 100 / 12)}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}

          {/* Credit cards */}
          <h2 className="px-1 pt-2 text-base font-semibold">Credit Cards</h2>
          {cards.length === 0 && (
            <Card hover={false}><Empty title="No cards tracked" sub="Track limits, utilization and due dates." /></Card>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cards.map((c) => {
              const util = c.limit > 0 ? c.outstanding / c.limit : 0;
              const due = daysUntil(c.dueDate);
              return (
                <Card key={c.id} className="group relative overflow-hidden p-5">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-chart-1/10 blur-2xl" />
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-[15px] font-semibold">{c.name}</h3>
                      <p className="num mt-0.5 text-xs text-text-3">
                        {c.bank} ···· {c.last4}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="sm" variant="ghost" onClick={() => setCardModal({ open: true, editing: c })}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { deleteCard(c.id); toast("Card removed"); }}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                  <p className="num mt-4 text-xl font-bold">{fmtINR(c.outstanding)}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-text-3">
                    <span>of {fmtINR(c.limit)} limit</span>
                    <span className={cn("font-semibold", util > 0.6 ? "text-negative" : util > 0.3 ? "text-warning" : "text-positive")}>
                      {Math.round(util * 100)}% used
                    </span>
                  </div>
                  <Progress value={util} tone={util > 0.6 ? "negative" : util > 0.3 ? "warning" : "positive"} className="mt-2" />
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                    <span className="text-text-3">
                      Min due <span className="num font-semibold text-text">{fmtINR(c.minDue)}</span>
                    </span>
                    <Badge tone={due <= 5 ? "negative" : due <= 10 ? "warning" : "neutral"}>
                      Due {fmtDate(c.dueDate)}
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Upcoming payments */}
        <div>
          <h2 className="px-1 pb-4 text-base font-semibold">Upcoming Payments</h2>
          <Card className="p-0" hover={false}>
            {upcoming.length === 0 ? (
              <Empty title="Nothing due" />
            ) : (
              upcoming.map((u, i) => {
                const d = daysUntil(u.date);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-0"
                  >
                    <div
                      className={cn(
                        "flex h-9 w-9 flex-none items-center justify-center rounded-md",
                        u.kind === "emi" ? "bg-chart-1/10 text-chart-1" : "bg-chart-4/10 text-chart-4"
                      )}
                    >
                      {u.kind === "emi" ? <Landmark size={15} /> : <CardIcon size={15} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{u.label}</p>
                      <p className={cn("text-xs", d < 0 ? "text-negative" : d <= 5 ? "text-warning" : "text-text-3")}>
                        {d < 0 ? `Overdue by ${-d}d` : d === 0 ? "Due today" : `In ${d} days`} · {fmtDate(u.date)}
                      </p>
                    </div>
                    <p className="num text-sm font-bold">{fmtINR(u.amount)}</p>
                  </div>
                );
              })
            )}
          </Card>
        </div>
      </div>

      <LoanModal state={loanModal} onClose={() => setLoanModal({ open: false, editing: null })} onSave={(data, id) => {
        if (id) { updateLoan(id, data); toast("Loan updated"); }
        else { addLoan({ ...data, businessId: activeBusiness } as Omit<Loan, "id">); toast("Loan added"); }
      }} />
      <CardModal state={cardModal} onClose={() => setCardModal({ open: false, editing: null })} onSave={(data, id) => {
        if (id) { updateCard(id, data); toast("Card updated"); }
        else { addCard({ ...data, businessId: activeBusiness } as Omit<CreditCard, "id">); toast("Card added"); }
      }} />
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4" hover={false}>
      <p className="flex items-center gap-2 text-xs font-medium text-text-3">{icon}{label}</p>
      <p className="num mt-2 text-xl font-bold">{value}</p>
    </Card>
  );
}

/* ── Loan modal ── */
function LoanModal({
  state,
  onClose,
  onSave,
}: {
  state: { open: boolean; editing: Loan | null };
  onClose: () => void;
  onSave: (data: Partial<Loan>, id?: string) => void;
}) {
  const e = state.editing;
  const [f, setF] = useState<Record<string, string>>({});
  const key = e?.id ?? "new";
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (state.open && lastKey !== key) {
    setLastKey(key);
    setF({
      name: e?.name ?? "", lender: e?.lender ?? "", kind: e?.kind ?? "business",
      principal: String(e?.principal ?? ""), outstanding: String(e?.outstanding ?? ""),
      interestRate: String(e?.interestRate ?? ""), emi: String(e?.emi ?? ""),
      nextDueDate: e?.nextDueDate ?? todayISO(), tenureMonths: String(e?.tenureMonths ?? "36"),
      paidMonths: String(e?.paidMonths ?? "0"),
    });
  }
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = () => {
    if (!f.name || !f.lender || !parseFloat(f.outstanding)) {
      toast("Name, lender and outstanding amount are required.", "error");
      return;
    }
    onSave(
      {
        name: f.name, lender: f.lender, kind: f.kind as Loan["kind"],
        principal: parseFloat(f.principal) || 0, outstanding: parseFloat(f.outstanding) || 0,
        interestRate: parseFloat(f.interestRate) || 0, emi: parseFloat(f.emi) || 0,
        nextDueDate: f.nextDueDate, tenureMonths: parseInt(f.tenureMonths) || 0,
        paidMonths: parseInt(f.paidMonths) || 0,
      },
      e?.id
    );
    onClose();
  };
  return (
    <Modal open={state.open} onClose={onClose} title={e ? "Edit Loan" : "Add Loan"} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Loan Name"><Input value={f.name ?? ""} onChange={(ev) => set("name", ev.target.value)} placeholder="Business Expansion Loan" /></Field>
        <Field label="Lender"><Input value={f.lender ?? ""} onChange={(ev) => set("lender", ev.target.value)} placeholder="HDFC Bank" /></Field>
        <Field label="Type">
          <Select value={f.kind ?? "business"} onChange={(ev) => set("kind", ev.target.value)}>
            <option value="business">Business Loan</option>
            <option value="personal">Personal Loan</option>
          </Select>
        </Field>
        <Field label="Interest Rate (% p.a.)"><Input mono type="number" value={f.interestRate ?? ""} onChange={(ev) => set("interestRate", ev.target.value)} /></Field>
        <Field label="Principal (₹)"><Input mono type="number" value={f.principal ?? ""} onChange={(ev) => set("principal", ev.target.value)} /></Field>
        <Field label="Outstanding (₹)"><Input mono type="number" value={f.outstanding ?? ""} onChange={(ev) => set("outstanding", ev.target.value)} /></Field>
        <Field label="EMI (₹/month)"><Input mono type="number" value={f.emi ?? ""} onChange={(ev) => set("emi", ev.target.value)} /></Field>
        <Field label="Next Due Date"><Input type="date" value={f.nextDueDate ?? ""} onChange={(ev) => set("nextDueDate", ev.target.value)} /></Field>
        <Field label="Tenure (months)"><Input mono type="number" value={f.tenureMonths ?? ""} onChange={(ev) => set("tenureMonths", ev.target.value)} /></Field>
        <Field label="Months Paid"><Input mono type="number" value={f.paidMonths ?? ""} onChange={(ev) => set("paidMonths", ev.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{e ? "Save" : "Add Loan"}</Button>
      </div>
    </Modal>
  );
}

/* ── Card modal ── */
function CardModal({
  state,
  onClose,
  onSave,
}: {
  state: { open: boolean; editing: CreditCard | null };
  onClose: () => void;
  onSave: (data: Partial<CreditCard>, id?: string) => void;
}) {
  const e = state.editing;
  const [f, setF] = useState<Record<string, string>>({});
  const key = e?.id ?? "new";
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (state.open && lastKey !== key) {
    setLastKey(key);
    setF({
      name: e?.name ?? "", bank: e?.bank ?? "", last4: e?.last4 ?? "",
      limit: String(e?.limit ?? ""), outstanding: String(e?.outstanding ?? ""),
      minDue: String(e?.minDue ?? ""), totalDue: String(e?.totalDue ?? ""),
      dueDate: e?.dueDate ?? todayISO(),
    });
  }
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = () => {
    if (!f.name || !f.bank) {
      toast("Card name and bank are required.", "error");
      return;
    }
    onSave(
      {
        name: f.name, bank: f.bank, last4: f.last4 || "0000",
        limit: parseFloat(f.limit) || 0, outstanding: parseFloat(f.outstanding) || 0,
        minDue: parseFloat(f.minDue) || 0, totalDue: parseFloat(f.totalDue) || parseFloat(f.outstanding) || 0,
        dueDate: f.dueDate,
      },
      e?.id
    );
    onClose();
  };
  return (
    <Modal open={state.open} onClose={onClose} title={e ? "Edit Credit Card" : "Add Credit Card"} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Card Name"><Input value={f.name ?? ""} onChange={(ev) => set("name", ev.target.value)} placeholder="HDFC Biz Black" /></Field>
        <Field label="Bank"><Input value={f.bank ?? ""} onChange={(ev) => set("bank", ev.target.value)} placeholder="HDFC Bank" /></Field>
        <Field label="Last 4 Digits"><Input mono maxLength={4} value={f.last4 ?? ""} onChange={(ev) => set("last4", ev.target.value)} /></Field>
        <Field label="Credit Limit (₹)"><Input mono type="number" value={f.limit ?? ""} onChange={(ev) => set("limit", ev.target.value)} /></Field>
        <Field label="Outstanding (₹)"><Input mono type="number" value={f.outstanding ?? ""} onChange={(ev) => set("outstanding", ev.target.value)} /></Field>
        <Field label="Minimum Due (₹)"><Input mono type="number" value={f.minDue ?? ""} onChange={(ev) => set("minDue", ev.target.value)} /></Field>
        <Field label="Total Due (₹)"><Input mono type="number" value={f.totalDue ?? ""} onChange={(ev) => set("totalDue", ev.target.value)} /></Field>
        <Field label="Due Date"><Input type="date" value={f.dueDate ?? ""} onChange={(ev) => set("dueDate", ev.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{e ? "Save" : "Add Card"}</Button>
      </div>
    </Modal>
  );
}
