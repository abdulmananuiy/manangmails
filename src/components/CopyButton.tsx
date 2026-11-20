"use client";

import { useState } from "react";

/** Small copy-to-clipboard button, used on the public pages (no login). */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" className="secondary" onClick={copy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
