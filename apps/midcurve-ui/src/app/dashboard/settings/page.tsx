"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UserDropdown } from "@/components/auth/user-dropdown";
import { HyperliquidConnection } from "@/components/settings/hyperliquid-connection";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Handle authentication redirect
  useEffect(() => {
    if (status === "unauthenticated" || (!session && status !== "loading")) {
      router.push("/?modal=signin");
    }
  }, [status, session, router]);

  // Show loading state
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  // Don't render anything while redirecting
  if (status === "unauthenticated" || !session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-4xl mx-auto px-4 lg:px-6 py-8">
        {/* Header */}
        <header className="flex justify-between items-center mb-12">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-white">Settings</h1>
              <p className="text-slate-400">Manage your account settings</p>
            </div>
          </div>
          <UserDropdown />
        </header>

        {/* Settings Sections */}
        <div className="space-y-8">
          {/* Hyperliquid Connection Section */}
          <HyperliquidConnection />
        </div>
      </div>
    </div>
  );
}
