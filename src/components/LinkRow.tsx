"use client";

import { useState } from "react";

export function LinkRow({ label, link }: { label: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="link-row">
      <span className="link-label">{label}</span>
      <code className="link-value">{link}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </li>
  );
}
