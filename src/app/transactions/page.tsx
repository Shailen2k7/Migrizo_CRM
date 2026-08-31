"use client";

import { useMemo, useState } from "react";
import {
  Copy,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useStore, allCategories } from "@/lib/store";
import { PAYMENT_METHODS, Transaction } from "@/lib/types";
import { fmtDateShort, fmtINR, fmtSigned } from "@/lib/format";
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, cn, toast } from "@/components/ui";
import { TransactionModal } from "@/components/TransactionModal";
import { BUSINESSES } from "@/lib/seed";

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const customCategories = useStore((s) => s.customCategories);
  const deleteTransactions = useStore((s) => s.deleteTransactions);
  const duplicateTransaction = useStore((s) => s.duplicateTransaction);
  const bulkUpdate = useStore((s) => s.bulkUpdate);

  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState("");
  const [vendor, setVendor] = useState("");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkMethod, setBulkMethod] = useState("");
  const [bulkTags, setBulkTags] = useState("");

  const cats = allCategories(customCategories);
  const biz = BUSINESSES.find((b) => b.id === activeBusiness)!;

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return transactions
      .filter((t) => {
        if (t.businessId !== activeBusiness) return false;
        if (category && t.category !== category) return false;
        if (method && t.paymentMethod !== method) return false;
        if (vendor && !(t.vendor ?? "").toLowerCase().includes(vendor.toLowerCase())) return false;
        if (client && !(t.client ?? "").toLowerCase().includes(client.toLowerCase())) return false;
        if (from && t.date < from) return false;
        if (to && t.date > to) return false;
        if (minAmt && t.amount < parseFloat(minAmt)) return false;
        if (maxAmt && t.amount > parseFloat(maxAmt)) return false;
        if (query) {
          const hay = `${t.description} ${t.category} ${t.vendor ?? ""} ${t.client ?? ""} ${t.notes ?? ""} ${t.tags.join(" ")} ${t.amount}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, activeBusiness, q, category, method, vendor, client, from, to, minAmt, maxAmt]);

  const pageRows = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const totals = useMemo(() => {
    const cr = filtered.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0);
    const dr = filtered.filter((t) => t.type === "debit").reduce((s, t) => s + t.amount, 0);
    return { cr, dr, net: cr - dr };
  }, [filtered]);

  const activeFilterCount = [category, method, vendor, client, from, to, minAmt, maxAmt].filter(Boolean).length;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(pageRows.map((t) => t.id)) : new Set());
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const clearFilters = () => {
    setCategory(""); setMethod(""); setVendor(""); setClient("");
    setFrom(""); setTo(""); setMinAmt(""); setMaxAmt(""); setQ("");
  };

  const applyBulk = () => {
    const patch: Record<string, unknown> = {};
    if (bulkCategory) patch.category = bulkCategory;
    if (bulkMethod) patch.paymentMethod = bulkMethod;
    if (bulkTags.trim()) patch.tags = bulkTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (Object.keys(patch).length === 0) {
      toast("Choose at least one field to update.", "error");
      return;
    }
    bulkUpdate(Array.from(selected), patch);
    toast(`Updated ${selected.size} transactions`);
    setBulkOpen(false);
    setSelected(new Set());
    setBulkCategory(""); setBulkMethod(""); setBulkTags("");
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <p className="label-caps mb-1">{biz.name}</p>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <Plus size={15} /> New Transaction
        </Button>
      </div>

      {/* Search + filters */}
      <Card className="p-4" hover={false}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <Input
              className="pl-9"
              placeholder="Search description, vendor, client, notes, tags, amount…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
          <Button variant={showFilters ? "primary" : "secondary"} onClick={() => setShowFilters((s) => !s)}>
            <Filter size={14} />
            Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </Button>
          {(activeFilterCount > 0 || q) && (
            <Button variant="ghost" onClick={clearFilters}>
              <X size={14} /> Clear
            </Button>
          )}
        </div>
        {showFilters && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 md:grid-cols-4 animate-fade-in">
            <Field label="Category">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {cats.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Payment Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">All methods</option>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Vendor">
              <Input placeholder="Any vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </Field>
            <Field label="Client">
              <Input placeholder="Any client" value={client} onChange={(e) => setClient(e.target.value)} />
            </Field>
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Min Amount">
              <Input mono type="number" placeholder="0" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} />
            </Field>
            <Field label="Max Amount">
              <Input mono type="number" placeholder="∞" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} />
            </Field>
          </div>
        )}
      </Card>

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-sm">
        <span className="text-text-3">
          <span className="num font-semibold text-text">{filtered.length}</span> transactions
        </span>
        <span className="text-text-3">
          In: <span className="num font-semibold text-positive">{fmtINR(totals.cr)}</span>
        </span>
        <span className="text-text-3">
          Out: <span className="num font-semibold text-negative">{fmtINR(totals.dr)}</span>
        </span>
        <span className="text-text-3">
          Net:{" "}
          <span className={cn("num font-semibold", totals.net >= 0 ? "text-positive" : "text-negative")}>
            {fmtINR(totals.net)}
          </span>
        </span>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-primary/30 p-3 animate-fade-in" hover={false}>
          <span className="px-2 text-sm font-semibold">{selected.size} selected</span>
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <Pencil size={13} /> Bulk Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              deleteTransactions(Array.from(selected));
              toast(`Deleted ${selected.size} transactions`);
              setSelected(new Set());
            }}
          >
            <Trash2 size={13} /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </Card>
      )}

      {/* Table */}
      <Card className="p-0" hover={false}>
        {pageRows.length === 0 ? (
          <Empty
            title="No transactions match"
            sub="Try adjusting filters, or import a bank statement to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={pageRows.length > 0 && pageRows.every((t) => selected.has(t.id))}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="accent-[rgb(var(--primary))]"
                    />
                  </th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Date</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Description</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Category</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Counterparty</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Method</th>
                  <th className="label-caps px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr
                    key={t.id}
                    className={cn(
                      "group border-b border-border/50 transition-colors last:border-0 hover:bg-surface-3/30",
                      selected.has(t.id) && "bg-primary/[0.05]"
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        className="accent-[rgb(var(--primary))]"
                      />
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-xs text-text-3">
                      {fmtDateShort(t.date)}
                    </td>
                    <td className="max-w-[300px] px-3 py-2.5">
                      <button
                        className="block w-full truncate text-left text-[13px] hover:text-primary"
                        title={t.description}
                        onClick={() => { setEditing(t); setModalOpen(true); }}
                      >
                        {t.description}
                      </button>
                      {t.tags.length > 0 && (
                        <div className="mt-0.5 flex gap-1">
                          {t.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded bg-surface-3 px-1.5 text-[10px] text-text-3">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={t.type === "credit" ? "positive" : "neutral"}>{t.category}</Badge>
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2.5 text-[13px] text-text-2">
                      {t.client ?? t.vendor ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-text-3">
                      {t.paymentMethod}
                      {t.source === "import" && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wide text-text-3/70">
                          · AI
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "num whitespace-nowrap px-3 py-2.5 text-right font-semibold",
                        t.type === "credit" ? "text-positive" : "text-text"
                      )}
                    >
                      {fmtSigned(t.amount, t.type)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <IconBtn title="Edit" onClick={() => { setEditing(t); setModalOpen(true); }}>
                          <Pencil size={13} />
                        </IconBtn>
                        <IconBtn title="Duplicate" onClick={() => { duplicateTransaction(t.id); toast("Transaction duplicated"); }}>
                          <Copy size={13} />
                        </IconBtn>
                        <IconBtn
                          title="Delete"
                          danger
                          onClick={() => { deleteTransactions([t.id]); toast("Transaction deleted"); }}
                        >
                          <Trash2 size={13} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > pageRows.length && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="ghost" onClick={() => setPage((p) => p + 1)}>
              Load more ({filtered.length - pageRows.length} remaining)
            </Button>
          </div>
        )}
      </Card>

      <TransactionModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />

      {/* Bulk edit modal */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Bulk Edit ${selected.size} Transactions`}>
        <div className="space-y-4">
          <Field label="Set Category (leave blank to keep)">
            <Select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
              <option value="">— Keep existing —</option>
              {cats.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Set Payment Method">
            <Select value={bulkMethod} onChange={(e) => setBulkMethod(e.target.value)}>
              <option value="">— Keep existing —</option>
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Replace Tags (comma separated)">
            <Input value={bulkTags} onChange={(e) => setBulkTags(e.target.value)} placeholder="e.g. reviewed, q3" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={applyBulk}>Apply to {selected.size}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function IconBtn({
  children,
  title,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "rounded p-1.5 text-text-3 transition-colors hover:bg-surface-3",
        danger ? "hover:text-negative" : "hover:text-text"
      )}
    >
      {children}
    </button>
  );
}
