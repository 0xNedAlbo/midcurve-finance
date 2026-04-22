/**
 * RevokeApiKeyModal
 *
 * Confirmation dialog for hard-deleting an API key. Once revoked, any client
 * using the key loses access immediately.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import type { ApiKeyResponse } from "@midcurve/api-shared";
import { useRevokeApiKey } from "@/hooks/api-keys/useApiKeys";

interface RevokeApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKeyResponse | null;
}

export function RevokeApiKeyModal({ isOpen, onClose, apiKey }: RevokeApiKeyModalProps) {
  const [mounted, setMounted] = useState(false);
  const revokeMutation = useRevokeApiKey();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted || !apiKey) return null;

  const handleRevoke = async () => {
    await revokeMutation.mutateAsync(apiKey.id);
    onClose();
  };

  const isPending = revokeMutation.isPending;

  const modalContent = (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={isPending ? undefined : onClose}
      />

      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">Revoke API Key</h2>
            </div>
            <button
              onClick={onClose}
              disabled={isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-slate-300 text-sm leading-relaxed">
              Revoke the key{" "}
              <span className="font-medium text-white">"{apiKey.name}"</span>?
              Any client using this key will lose access immediately. This cannot be undone.
            </p>

            <div className="bg-slate-700/30 rounded-lg p-3 font-mono text-xs text-slate-400">
              {apiKey.keyPrefix}…
            </div>

            {revokeMutation.isError && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {revokeMutation.error?.message || "Failed to revoke key"}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={isPending}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={isPending}
                className="flex-1 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Revoking...
                  </>
                ) : (
                  "Revoke Key"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
