"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CloudUpload,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useStore, allCategories } from "@/lib/store";
import { ParseResult, parseStatementFile } from "@/lib/parsers";
import { categorize, detectPaymentMethod, extractVendor, txnFingerprint } from "@/lib/categorize";
import { ImportBatch, ImportedRow, Transaction } from "@/lib/types";
import { fmtDateShort, fmtINR, fmtSigned, uid } from "@/lib/format";
import { Badge, Button, Card, Empty, Select, cn, toast } from "@/components/ui";
import { BUSINESSES } from "@/lib/seed";

export default function ImportPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const categoryMemory = useStore((s) => s.categoryMemory);
  const customCategories = useStore((s) => s.customCategories);
  const importHistory = useStore((s) => s.importHistory);
  const importTransactions = useStore((s) => s.importTransactions);

  const setStatementBalance = useStore((s) => s.setStatementBalance);

  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState<string | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideRecon, setOverrideRecon] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const biz = BUSINESSES.find((b) => b.id === activeBusiness)!;
  const cats = allCategories(customCategories);

  // Fingerprints of existing transactions for duplicate detection
  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    transactions
      .filter((t) => t.businessId === activeBusiness)
      .forEach((t) => set.add(txnFingerprint(t.date, t.amount, t.description)));
    return set;
  }, [transactions, activeBusiness]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (!file) return;
      setError(null);
      setParsing(file.name);
      setBatch(null);
      setParsed(null);
      setOverrideRecon(false);
      try {
        const result = await parseStatementFile(file);
        setParsed(result);
        if (result.rows.length === 0) {
          setError(result.warnings[0] ?? "No transactions could be parsed from this file.");
          return;
        }
        const seen = new Set<string>();
        const rows: ImportedRow[] = result.rows.map((r) => {
          const suggestion = categorize(r.description, r.type, categoryMemory);
          const key = txnFingerprint(r.date, r.amount, r.description);
          const isDuplicate = existingKeys.has(key) || seen.has(key);
          seen.add(key);
          return {
            id: uid("row"),
            date: r.date,
            description: r.description,
            amount: r.amount,
            type: r.type,
            category: suggestion.category,
            paymentMethod: detectPaymentMethod(r.description),
            bank: result.bank,
            vendor: suggestion.vendor ?? extractVendor(r.description),
            aiConfidence: suggestion.confidence,
            isDuplicate,
            include: !isDuplicate,
          };
        });
        setBatch({ fileName: file.name, bank: result.bank, rows });
        if (result.warnings.length) toast(result.warnings[0], "info");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to parse file.");
      } finally {
        setParsing(null);
      }
    },
    [categoryMemory, existingKeys]
  );

  const approve = () => {
    if (!batch) return;
    const now = new Date().toISOString();
    const included = batch.rows.filter((r) => r.include);
    const txns: Transaction[] = included.map((r) => ({
      id: uid("txn"),
      businessId: activeBusiness,
      date: r.date,
      amount: r.amount,
      type: r.type,
      description: r.description,
      category: r.category,
      vendor: r.vendor,
      paymentMethod: r.paymentMethod,
      bank: r.bank,
      tags: [],
      source: "import",
      aiConfidence: r.aiConfidence,
      createdAt: now,
      updatedAt: now,
      audit: [{ at: now, action: "imported" }],
    }));
    importTransactions(txns, {
      businessId: activeBusiness,
      fileName: batch.fileName,
      bank: batch.bank,
      count: txns.length,
      skippedDuplicates: batch.rows.filter((r) => r.isDuplicate).length,
    });
    // Record the statement's own closing balance — the Cash/Bank card uses
    // this rather than a computed figure, so a parse slip can never quietly
    // change what the dashboard claims is in the bank.
    const closing = parsed?.summary.closingBalance;
    if (closing !== undefined) {
      const asOf = included.reduce((max, r) => (r.date > max ? r.date : max), included[0]?.date ?? "");
      setStatementBalance(activeBusiness, { closing, asOf, fileName: batch.fileName });
    }
    toast(`Imported ${txns.length} transactions into ${biz.name}`);
    setBatch(null);
    setParsed(null);
  };

  const recon = parsed?.reconciliation;
  /** A statement that doesn't tie to its own closing balance has been misread. */
  const importBlocked = recon?.ok === false && !overrideRecon;

  const setRow = (id: string, patch: Partial<ImportedRow>) =>
    setBatch((b) =>
      b ? { ...b, rows: b.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : b
    );

  const stats = useMemo(() => {
    if (!batch) return null;
    const inc = batch.rows.filter((r) => r.include);
    return {
      total: batch.rows.length,
      included: inc.length,
      duplicates: batch.rows.filter((r) => r.isDuplicate).length,
      credits: inc.filter((r) => r.type === "credit").reduce((s, r) => s + r.amount, 0),
      debits: inc.filter((r) => r.type === "debit").reduce((s, r) => s + r.amount, 0),
      highConf: batch.rows.filter((r) => r.aiConfidence === "high").length,
    };
  }, [batch]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="animate-fade-up">
        <p className="label-caps mb-1">Blink Import — {biz.name}</p>
        <h1 className="text-3xl font-bold tracking-tight">Import Statements</h1>
        <p className="mt-1 text-sm text-text-3">
          Drop bank files and AI extracts, cleans and categorizes every transaction. No manual
          formatting needed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Dropzone */}
        <div
          className={cn(
            "xl:col-span-2 relative flex min-h-[320px] cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 text-center transition-all duration-300",
            dragOver
              ? "border-primary bg-primary/10 scale-[1.005]"
              : "border-border-strong/60 bg-surface/40 hover:border-primary/50 hover:bg-primary/5"
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.csv,.xls,.xlsx,.txt"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          {parsing ? (
            <>
              <Loader2 size={40} className="animate-spin text-primary" />
              <div>
                <p className="text-lg font-semibold">Processing {parsing}…</p>
                <p className="mt-1 text-sm text-text-3">
                  Extracting transactions, detecting bank format, running AI categorization
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-card">
                <CloudUpload size={36} />
              </div>
              <div>
                <p className="text-xl font-bold">Drop files or click to upload</p>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-text-3">
                  AI automatically extracts dates, amounts, debit/credit, UPI/NEFT/RTGS/IMPS/Card
                  methods and merchants from your statements. All major Indian banks supported.
                </p>
              </div>
              <div className="mt-2 flex items-center gap-3">
                {[
                  { icon: <FileText size={18} />, label: "PDF" },
                  { icon: <FileSpreadsheet size={18} />, label: "CSV" },
                  { icon: <FileSpreadsheet size={18} />, label: "XLS / XLSX" },
                ].map((f) => (
                  <span
                    key={f.label}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-text-2"
                  >
                    {f.icon}
                    {f.label}
                  </span>
                ))}
              </div>
              {error && (
                <p className="mt-2 rounded-md border border-negative/30 bg-negative/10 px-4 py-2 text-sm font-medium text-negative">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Recent imports */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <History size={15} className="text-text-3" />
            <h2 className="text-sm font-semibold">Recent Imports</h2>
          </div>
          {importHistory.filter((h) => h.businessId === activeBusiness).length === 0 ? (
            <Empty title="No imports yet" sub="Your import history will appear here." />
          ) : (
            <div className="space-y-2.5">
              {importHistory
                .filter((h) => h.businessId === activeBusiness)
                .slice(0, 6)
                .map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-surface-2/60 px-3 py-2.5"
                  >
                    <CheckCircle2 size={16} className="flex-none text-positive" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{h.fileName}</p>
                      <p className="text-[11px] text-text-3">
                        {h.bank} · {h.count} txns · {h.skippedDuplicates} duplicates skipped
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>

      {/* Review batch */}
      {batch && stats && (
        <Card className="animate-fade-up p-0" hover={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-2.5 w-2.5 rounded-full bg-gold animate-pulse" />
              <div>
                <p className="text-sm font-semibold">
                  Review: {batch.fileName}
                  <span className="ml-2 text-text-3 font-normal">({batch.bank})</span>
                </p>
                <p className="text-xs text-text-3">
                  {stats.included} of {stats.total} selected · {stats.duplicates} duplicates
                  detected · {stats.highConf} high-confidence AI matches ·{" "}
                  <span className="text-positive">+{fmtINR(stats.credits)}</span> /{" "}
                  <span className="text-negative">-{fmtINR(stats.debits)}</span>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setBatch(null)}>
                <Trash2 size={14} /> Discard Batch
              </Button>
              <Button
                variant="primary"
                onClick={approve}
                disabled={stats.included === 0 || importBlocked}
              >
                <CheckCircle2 size={15} /> Approve &amp; Import {stats.included}
              </Button>
            </div>
          </div>

          {/* Reconciliation gate — the statement's own totals are the check */}
          {parsed && (
            <div
              className={cn(
                "flex items-start gap-2.5 border-b px-5 py-3",
                recon?.ok === false
                  ? "border-negative/30 bg-negative/[0.07]"
                  : recon?.checked
                    ? "border-border bg-positive/[0.05]"
                    : "border-border bg-warning/[0.06]"
              )}
            >
              {recon?.ok === false ? (
                <ShieldAlert size={16} className="mt-0.5 flex-none text-negative" />
              ) : recon?.checked ? (
                <ShieldCheck size={16} className="mt-0.5 flex-none text-positive" />
              ) : (
                <ShieldAlert size={16} className="mt-0.5 flex-none text-warning" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[13px] font-semibold",
                    recon?.ok === false ? "text-negative" : "text-text"
                  )}
                >
                  {recon?.ok === false
                    ? "Parse error — this file does not reconcile"
                    : recon?.checked
                      ? "Reconciled against the statement"
                      : "Could not be reconciled"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-2">{recon?.message}</p>
                {recon?.ok === false && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-text-3">
                    <input
                      type="checkbox"
                      checked={overrideRecon}
                      onChange={(e) => setOverrideRecon(e.target.checked)}
                      className="accent-[rgb(var(--primary))]"
                    />
                    Import anyway — I understand the totals will be wrong
                  </label>
                )}
              </div>
            </div>
          )}
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={batch.rows.every((r) => r.include)}
                      onChange={(e) =>
                        setBatch((b) =>
                          b
                            ? { ...b, rows: b.rows.map((r) => ({ ...r, include: e.target.checked })) }
                            : b
                        )
                      }
                      className="accent-[rgb(var(--primary))]"
                    />
                  </th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Date</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Description</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Category</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Method</th>
                  <th className="label-caps px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-border/50 transition-colors last:border-0",
                      !r.include && "opacity-40",
                      r.isDuplicate && "bg-warning/[0.04]"
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => setRow(r.id, { include: e.target.checked })}
                        className="accent-[rgb(var(--primary))]"
                      />
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-xs text-text-3">
                      {fmtDateShort(r.date)}
                    </td>
                    <td className="max-w-[300px] truncate px-3 py-2.5 text-[13px]" title={r.description}>
                      {r.description}
                    </td>
                    <td className="px-3 py-2.5">
                      <Select
                        value={r.category}
                        onChange={(e) => setRow(r.id, { category: e.target.value })}
                        className="h-8 w-40 text-xs"
                      >
                        {cats.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone="neutral">{r.paymentMethod}</Badge>
                    </td>
                    <td
                      className={cn(
                        "num whitespace-nowrap px-3 py-2.5 text-right font-semibold",
                        r.type === "credit" ? "text-positive" : "text-negative"
                      )}
                    >
                      {fmtSigned(r.amount, r.type)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {r.isDuplicate ? (
                        <Badge tone="warning">Duplicate</Badge>
                      ) : (
                        <Badge
                          tone={
                            r.aiConfidence === "high"
                              ? "positive"
                              : r.aiConfidence === "medium"
                                ? "info"
                                : "neutral"
                          }
                        >
                          <Sparkles size={10} /> AI {r.aiConfidence}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

