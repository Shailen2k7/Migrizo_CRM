"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/components/ui";

/** Inline add/remove editor for a transaction's tag list. */
export function TagEditor({
  tags,
  onChange,
  className,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");

  const commit = () => {
    const clean = val.trim().toLowerCase().replace(/\s+/g, "-");
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setVal("");
    setAdding(false);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="group/tag inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-2"
        >
          #{tag}
          <button
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="opacity-0 transition-opacity hover:text-negative group-hover/tag:opacity-100"
            title={`Remove #${tag}`}
          >
            <X size={9} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setVal("");
              setAdding(false);
            }
          }}
          onBlur={commit}
          placeholder="tag"
          className="h-[18px] w-16 rounded border border-border bg-surface-2 px-1 text-[10px] outline-none focus:border-primary/50"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          title="Add tag"
          className="rounded p-0.5 text-text-3 transition-colors hover:bg-surface-3 hover:text-primary"
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  );
}
