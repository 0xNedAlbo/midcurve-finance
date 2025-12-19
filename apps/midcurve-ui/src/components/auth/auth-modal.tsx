import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { SiweMessage } from "siwe";
import { X } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { apiClient } from "@/lib/api-client";

export function AuthModal() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const modalType = searchParams.get("modal");
  const { signIn, signUp } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { address, isConnected, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Open modal when modal param is present
  useEffect(() => {
    if (modalType === "signin" || modalType === "signup") {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [modalType]);

  // Close modal and remove param
  const closeModal = useCallback(() => {
    setIsOpen(false);
    setError("");

    // Remove modal param from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("modal");
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  // Handle ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closeModal();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, closeModal]);

  const handleSiweAuth = async () => {
    if (!address || !isConnected) return;

    setIsLoading(true);
    setError("");

    try {
      // 1. Fetch nonce from API
      const nonceResponse = await apiClient.get<{ nonce: string }>('/api/v1/auth/nonce');

      if (!nonceResponse.data) {
        throw new Error("Failed to fetch nonce from API");
      }

      const nonce = nonceResponse.data.nonce;

      // 2. Create SIWE message parameters
      const domain = window.location.host;
      const origin = window.location.origin;
      const statement = "Sign in to Midcurve to manage your DeFi positions";

      const siweMessageParams = {
        domain,
        address,
        statement,
        uri: origin,
        version: "1" as const,
        chainId: chain?.id || 1,
        nonce,
        issuedAt: new Date().toISOString(),
      };

      // Create SiweMessage instance for signing
      const siweMessage = new SiweMessage(siweMessageParams);
      const messageBody = siweMessage.prepareMessage();

      // 3. Sign the message with wallet
      const signature = await signMessageAsync({
        message: messageBody,
      });

      // 4. Submit to our auth system
      if (modalType === "signup") {
        await signUp(address, messageBody, signature);
      } else {
        await signIn(address, messageBody, signature);
      }

      // Success - close modal and redirect
      closeModal();
      navigate("/dashboard");
    } catch (err) {
      console.error("SIWE authentication error:", err);

      if (err instanceof Error) {
        if (err.message.includes("User rejected")) {
          setError("Signature request was cancelled.");
        } else if (err.message.includes("nonce")) {
          setError("Failed to generate authentication nonce. Please try again.");
        } else if (err.message.includes("WALLET_ALREADY_REGISTERED")) {
          setError("This wallet is already registered. Please sign in instead.");
        } else if (err.message.includes("WALLET_NOT_REGISTERED")) {
          setError("This wallet is not registered. Please sign up first.");
        } else {
          setError(err.message || "Authentication failed. Please try again.");
        }
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const title = modalType === "signup" ? "Sign Up" : "Sign In";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={closeModal}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <button
              onClick={closeModal}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            <p className="text-slate-300 text-center">
              Connect your wallet to access Midcurve
            </p>

            {/* Connect Wallet Button */}
            <div className="flex justify-center">
              <ConnectButton showBalance={false} />
            </div>

            {/* Sign Message Button (only when connected) */}
            {isConnected && address && (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-sm text-slate-400">
                    Connected: {address.slice(0, 6)}...{address.slice(-4)}
                  </p>
                </div>

                <button
                  onClick={handleSiweAuth}
                  disabled={isLoading}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? "Signing..." : "Sign Message to Continue"}
                </button>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="rounded-md bg-red-900/20 border border-red-500/20 p-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
