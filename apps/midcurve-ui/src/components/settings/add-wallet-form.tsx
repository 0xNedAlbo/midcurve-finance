"use client";

import { useState, useMemo } from "react";
import { CheckCircle, AlertTriangle, Loader2, X, Eye, EyeOff } from "lucide-react";
import { privateKeyToAddress } from "viem/accounts";
import { useRegisterHyperliquidWallet } from "@/hooks/user/useHyperliquidWallets";

interface AddWalletFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Validate private key format (0x + 64 hex chars)
 */
function isValidPrivateKey(key: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(key);
}

/**
 * Derive address from private key
 */
function deriveAddress(privateKey: string): string | null {
  if (!isValidPrivateKey(privateKey)) return null;
  try {
    return privateKeyToAddress(privateKey as `0x${string}`);
  } catch {
    return null;
  }
}

/**
 * Calculate default expiration (180 days from now)
 */
function getDefaultExpiration(): string {
  const date = new Date();
  date.setDate(date.getDate() + 180);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD format
}

export function AddWalletForm({ onSuccess, onCancel }: AddWalletFormProps) {
  // Form state
  const [privateKey, setPrivateKey] = useState("");
  const [label, setLabel] = useState("Midcurve Hedge Wallet");
  const [expirationDate, setExpirationDate] = useState(getDefaultExpiration());
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [verified, setVerified] = useState(false);

  const registerWallet = useRegisterHyperliquidWallet({
    onSuccess: () => {
      onSuccess();
    },
  });

  // Derive address when private key changes
  const derivedAddress = useMemo(() => {
    return deriveAddress(privateKey);
  }, [privateKey]);

  // Validate form
  const isPrivateKeyValid = isValidPrivateKey(privateKey);
  const isLabelValid = label.length >= 1 && label.length <= 50;
  const isExpirationValid = new Date(expirationDate) > new Date();
  const canVerify = isPrivateKeyValid && isLabelValid && isExpirationValid;
  const canSubmit = canVerify && verified && confirmed;

  // Handle verify
  const handleVerify = () => {
    if (canVerify && derivedAddress) {
      setVerified(true);
    }
  };

  // Reset verification when form changes
  const handleInputChange = () => {
    if (verified) {
      setVerified(false);
      setConfirmed(false);
    }
  };

  // Handle submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    // Convert date to ISO string with time (end of day)
    const expiresAt = new Date(expirationDate);
    expiresAt.setHours(23, 59, 59, 999);

    registerWallet.mutate({
      privateKey,
      label,
      environment: "mainnet", // Mainnet only
      expiresAt: expiresAt.toISOString(),
      confirmed,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Add API Wallet</h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Warning Banner */}
      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-200/80">
            <p className="font-medium mb-1">Security Notice</p>
            <p>
              Your private key will be stored on our server in encrypted form.
              Never use your main wallet private key. Create an API wallet at{" "}
              <a
                href="https://app.hyperliquid.xyz/API"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
              >
                app.hyperliquid.xyz/API
              </a>{" "}
              and only use the generated private key in this form.
            </p>
          </div>
        </div>
      </div>

      {/* Private Key Input */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          API Wallet Private Key
        </label>
        <div className="relative">
          <input
            type={showPrivateKey ? "text" : "password"}
            value={privateKey}
            onChange={(e) => {
              setPrivateKey(e.target.value);
              handleInputChange();
            }}
            placeholder="0x..."
            className={`w-full px-4 py-3 pr-10 bg-slate-900/50 border rounded-lg text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:ring-2 ${
              privateKey && !isPrivateKeyValid
                ? "border-red-500 focus:ring-red-500"
                : "border-slate-700 focus:ring-blue-500"
            }`}
          />
          <button
            type="button"
            onClick={() => setShowPrivateKey(!showPrivateKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
          >
            {showPrivateKey ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>
        {privateKey && !isPrivateKeyValid && (
          <p className="mt-1 text-sm text-red-400">
            Invalid format. Must be 0x followed by 64 hex characters.
          </p>
        )}
      </div>

      {/* Label Input */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            handleInputChange();
          }}
          maxLength={50}
          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-sm text-slate-500">{label.length}/50 characters</p>
      </div>

      {/* Expiration Date */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          API Wallet Expiration
        </label>
        <input
          type="date"
          value={expirationDate}
          onChange={(e) => {
            setExpirationDate(e.target.value);
            handleInputChange();
          }}
          min={new Date().toISOString().split("T")[0]}
          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-sm text-slate-500">
          When does your Hyperliquid API wallet expire? Default is 180 days from
          creation.
        </p>
        {!isExpirationValid && (
          <p className="mt-1 text-sm text-red-400">
            Expiration date must be in the future.
          </p>
        )}
      </div>

      {/* Verify Button and Result */}
      {!verified && (
        <button
          type="button"
          onClick={handleVerify}
          disabled={!canVerify}
          className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg transition-colors disabled:cursor-not-allowed cursor-pointer"
        >
          Verify Wallet Address
        </button>
      )}

      {/* Verified Address Display */}
      {verified && derivedAddress && (
        <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-medium">Address Verified</span>
          </div>
          <p className="text-sm text-slate-300 mb-2">
            The following address will be registered:
          </p>
          <code className="block text-sm text-white font-mono bg-slate-900/50 px-3 py-2 rounded">
            {derivedAddress}
          </code>
        </div>
      )}

      {/* Confirmation Checkbox */}
      {verified && (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 text-blue-500"
          />
          <span className="text-sm text-slate-300">
            I understand that my private key will be stored encrypted on Midcurve
            servers and will be used to sign Hyperliquid transactions on my behalf.
            I confirm that this is an API wallet created specifically for Midcurve.
          </span>
        </label>
      )}

      {/* Error Display */}
      {registerWallet.error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4">
          <p className="text-red-400">
            {registerWallet.error.message}
          </p>
        </div>
      )}

      {/* Submit Button */}
      {verified && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setVerified(false);
              setConfirmed(false);
            }}
            className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors cursor-pointer"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={!canSubmit || registerWallet.isPending}
            className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white rounded-lg transition-colors disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
          >
            {registerWallet.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Registering...
              </>
            ) : (
              "Register Wallet"
            )}
          </button>
        </div>
      )}
    </form>
  );
}
