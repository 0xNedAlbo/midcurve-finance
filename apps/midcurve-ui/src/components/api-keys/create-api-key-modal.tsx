/**
 * CreateApiKeyModal
 *
 * Two-step modal:
 *   1. Form (name + expiry) → submits to backend
 *   2. Reveal (raw key in CopyableField with one-time-show warning)
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, Loader2, Key } from "lucide-react";
import type { ApiKeyExpiryDays, CreateApiKeyData } from "@midcurve/api-shared";
import { useCreateApiKey } from "@/hooks/api-keys/useApiKeys";
import { CopyableField } from "@/components/ui/copyable-field";

interface CreateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExpiryChoice = ApiKeyExpiryDays | "none";

const EXPIRY_OPTIONS: { value: ExpiryChoice; label: string }[] = [
  { value: "none", label: "Never" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

export function CreateApiKeyModal({ isOpen, onClose }: CreateApiKeyModalProps) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("none");
  const [created, setCreated] = useState<CreateApiKeyData | null>(null);

  const createMutation = useCreateApiKey();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const result = await createMutation.mutateAsync({
      name: trimmed,
      expiresInDays: expiry === "none" ? null : expiry,
    });
    setCreated(result);
  };

  const isPending = createMutation.isPending;
  const showReveal = created !== null;

  const modalContent = (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={isPending ? undefined : onClose}
      />

      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <Key className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                {showReveal ? "Save your key" : "Create API Key"}
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step 1: Form */}
          {!showReveal && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Claude Desktop, CI pipeline"
                  maxLength={100}
                  required
                  disabled={isPending}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Give the key a label to help you identify it later.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Expiration
                </label>
                <select
                  value={expiry}
                  onChange={(e) =>
                    setExpiry(
                      e.target.value === "none"
                        ? "none"
                        : (Number(e.target.value) as ApiKeyExpiryDays)
                    )
                  }
                  disabled={isPending}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer"
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {createMutation.isError && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                  {createMutation.error?.message || "Failed to create key"}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || name.trim().length === 0}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Key"
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Reveal */}
          {showReveal && created && (
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium">Save this key now.</p>
                  <p className="text-amber-300/80 mt-1">
                    You won't be able to see it again. If you lose it, revoke this
                    key and create a new one.
                  </p>
                </div>
              </div>

              <CopyableField label={created.name} value={created.key} />

              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
