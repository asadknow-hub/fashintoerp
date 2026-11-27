"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

// A small button that copies a piece of text, ready to paste somewhere else
// (the delivery company's portal, for example). It shows a tick for a moment
// once the text is copied.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers, or a page not opened over https: copy the old way.
      const box = document.createElement("textarea");
      box.value = text;
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    }
    setCopied(true);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      data-copy={label}
      className={
        "ml-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded align-middle transition " +
        (copied
          ? "bg-emerald-100 text-emerald-700"
          : "text-stone-400 hover:bg-brand-100 hover:text-brand")
      }
    >
      {copied ? <Check className="size-3.5" strokeWidth={2.6} /> : <Copy className="size-3.5" />}
    </button>
  );
}
