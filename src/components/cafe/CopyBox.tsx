"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A value plus a copy button.
 *
 * These commands are pasted into PowerShell on a shop machine, so the whole
 * string has to survive the copy exactly — a line break in the middle of the
 * install command silently truncates it and PowerShell runs half of it. The
 * box therefore scrolls sideways rather than wrapping.
 */
export function CopyBox({
  title,
  hint,
  value,
  tone = "primary",
}: {
  title: string;
  hint?: string;
  value: string;
  tone?: "primary" | "accent";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard API needs a secure context; fall back to the old selection trick
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  const ring = tone === "accent" ? "border-accent/60" : "border-primary/40";

  return (
    <section className={`overflow-hidden rounded-2xl border-2 ${ring} bg-card`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-3">
        <h2 className="text-lg font-extrabold text-primary">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>

      <div className="p-4">
        <pre
          dir="ltr"
          className="mb-3 max-w-full overflow-x-auto rounded-xl bg-foreground/5 p-3 text-left text-[13px] leading-relaxed"
        >
          <code className="whitespace-pre">{value}</code>
        </pre>

        <button
          onClick={copy}
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-extrabold transition active:scale-[0.98] ${
            copied
              ? "bg-emerald-600 text-white"
              : tone === "accent"
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
          {copied ? "تم النسخ ✓" : "نسخ"}
        </button>
      </div>
    </section>
  );
}
