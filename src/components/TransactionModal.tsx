"use client";

import { useEffect, useState } from "react";
import { useStore, allCategories } from "@/lib/store";
import { PAYMENT_METHODS, PaymentMethod, Transaction, TxnType } from "@/lib/types";
import { Button, Field, Input, Modal, Select, Textarea, toast } from "@/components/ui";
import { BUSINESSES } from "@/lib/seed";
import { todayISO } from "@/lib/format";
import { History } from "lucide-react";

export function TransactionModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Transaction | null;
}) {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const customCategories = useStore((s) => s.customCategories);
  const addTransaction = useStore((s) => s.addTransaction);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const addCustomCategory = useStore((s) => s.addCustomCategory);
  const cats = allCategories(customCategories);

  const [showAudit, setShowAudit] = useState(false);
  const [form, setForm] = useState(() => blank(activeBusiness));

  useEffect(() => {
    if (open) {
      setShowAudit(false);
      setForm(
        editing
          ? {
              businessId: editing.businessId,
              date: editing.date,
              amount: String(editing.amount),
              type: editing.type,
              description: editing.description,
              category: editing.category,
              vendor: editing.vendor ?? "",
              client: editing.client ?? "",
              paymentMethod: editing.paymentMethod,
              notes: editing.notes ?? "",
              tags: editing.tags.join(", "),
            }
          : blank(activeBusiness)
      );
    }
  }, [open, editing, activeBusiness]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    const amount = parseFloat(form.amount);
    if (!form.description.trim() || !isFinite(amount) || amount <= 0 || !form.date) {
      toast("Please fill date, description and a valid amount.", "error");
      return;
    }
    if (!cats.includes(form.category)) addCustomCategory(form.category);
    const payload = {
      businessId: form.businessId as Transaction["businessId"],
      date: form.date,
      amount,
      type: form.type as TxnType,
      description: form.description.trim(),
      category: form.category,
      vendor: form.vendor.trim() || undefined,
      client: form.client.trim() || undefined,
      paymentMethod: form.paymentMethod as PaymentMethod,
      notes: form.notes.trim() || undefined,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (editing) {
      updateTransaction(editing.id, payload);
      toast("Transaction updated — dashboards refreshed");
    } else {
      addTransaction({ ...payload, aiConfidence: undefined, bank: undefined });
      toast("Transaction added");
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit Transaction" : "New Transaction"} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business">
          <Select value={form.businessId} onChange={(e) => set("businessId", e.target.value)}>
            {BUSINESSES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
            <option value="debit">Money Out (Debit)</option>
            <option value="credit">Money In (Credit)</option>
          </Select>
        </Field>
        <Field label="Amount (₹)">
          <Input
            mono
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Input
            placeholder="e.g. NEFT — Acme Corp consulting retainer"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field label="Category">
          <Input
            list="cat-list"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          />
          <datalist id="cat-list">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Payment Method">
          <Select value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor">
          <Input placeholder="Who was paid" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
        </Field>
        <Field label="Client">
          <Input placeholder="Who paid you" value={form.client} onChange={(e) => set("client", e.target.value)} />
        </Field>
        <Field label="Tags (comma separated)" className="sm:col-span-2">
          <Input placeholder="ads, q3, priority" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            placeholder="Internal notes for your CA or future you…"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>

      {editing && (
        <div className="mt-4 rounded-md border border-border bg-surface-2/50">
          <button
            className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-2 hover:text-text"
            onClick={() => setShowAudit((s) => !s)}
          >
            <History size={13} />
            Audit History ({editing.audit.length}) {showAudit ? "▾" : "▸"}
          </button>
          {showAudit && (
            <div className="max-h-44 space-y-1.5 overflow-y-auto border-t border-border px-4 py-3">
              {[...editing.audit].reverse().map((a, i) => (
                <p key={i} className="text-xs text-text-3">
                  <span className="num text-text-2">
                    {new Date(a.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </span>{" "}
                  — <span className="font-semibold text-text-2">{a.action}</span>
                  {a.field && (
                    <>
                      {" "}
                      {a.field}: <span className="line-through">{a.from || "∅"}</span> →{" "}
                      <span className="text-text-2">{a.to || "∅"}</span>
                    </>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          {editing ? "Save Changes" : "Add Transaction"}
        </Button>
      </div>
    </Modal>
  );
}

function blank(businessId: string) {
  return {
    businessId,
    date: todayISO(),
    amount: "",
    type: "debit",
    description: "",
    category: "Miscellaneous",
    vendor: "",
    client: "",
    paymentMethod: "UPI",
    notes: "",
    tags: "",
  };
}
