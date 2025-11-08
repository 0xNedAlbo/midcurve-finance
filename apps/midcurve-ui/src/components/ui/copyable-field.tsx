"use client";

import { useState } from "react";
import { Copy, ExternalLink, Check } from "lucide-react";

interface CopyableFieldProps {
  label: string;
  value: string;
  href?: string;
  isAddress?: boolean;
}

/**
 * CopyableField Component
 *
 * Displays a technical value with copy-to-clipboard functionality and optional explorer link.
 *
 * Features:
 * - Monospace font for technical data
 * - Copy button with 2-second success feedback
 * - Optional external link (for block explorers)
 * - Address-friendly formatting (word-break for long addresses)
 * - Glassmorphic dark theme styling
 */
export function CopyableField({
  label,
  value,
  href,
  isAddress = false,
}: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-300">{label}</div>
      <div className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <span
          className={`font-mono text-sm flex-1 text-white ${
            isAddress ? "break-all" : ""
          }`}
        >
          {value}
        </span>
        <div className="flex items-center gap-1">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
              title="View on explorer"
            >
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </a>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
