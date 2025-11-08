"use client";

import { AuthModal } from "@/components/auth/auth-modal";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

export default function Home() {
    const { status } = useSession();
    const router = useRouter();

    // Redirect authenticated users to dashboard
    useEffect(() => {
        if (status === "authenticated") {
            router.push("/dashboard");
        }
    }, [status, router]);

    // Show loading while checking authentication
    if (status === "loading") {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
                <div className="text-white">Loading...</div>
            </div>
        );
    }

    // Landing page for unauthenticated users
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
            <AuthModal />
            <div className="container mx-auto px-4 py-8">
                {/* Header */}
                <header className="mb-12">
                    <div>
                        <h1 className="text-4xl font-bold text-white mb-2">
                            Midcurve
                        </h1>
                        <p className="text-lg text-slate-300">
                            Uniswap V3 Risk Management Platform
                        </p>
                    </div>
                </header>

                {/* Main Content - Landing Page */}
                <div className="max-w-4xl mx-auto">
                    {/* Hero Section */}
                    <div className="text-center mb-16">
                        <div className="text-8xl mb-8">📈</div>
                        <h2 className="text-3xl font-bold text-white mb-6">
                            Manage Your Uniswap V3 Positions
                        </h2>
                        <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                            Plan, visualize, and manage your liquidity positions with advanced risk analysis and comprehensive PnL curve visualization.
                        </p>

                        <div className="flex gap-4 justify-center">
                            <Link
                                href="/?modal=signup"
                                className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                            >
                                Get Started
                            </Link>
                            <Link
                                href="/?modal=signin"
                                className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors"
                            >
                                Sign In
                            </Link>
                        </div>
                    </div>

                    {/* Features */}
                    <div className="grid md:grid-cols-3 gap-8 mb-16">
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                            <div className="text-4xl mb-4">🎯</div>
                            <h3 className="text-xl font-semibold text-white mb-2">
                                Risk-Aware Planning
                            </h3>
                            <p className="text-slate-400">
                                Understand your position&apos;s risk profile with our three-phase PnL visualization.
                            </p>
                        </div>

                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                            <div className="text-4xl mb-4">📊</div>
                            <h3 className="text-xl font-semibold text-white mb-2">
                                Interactive Charts
                            </h3>
                            <p className="text-slate-400">
                                Visualize profit and loss scenarios with dynamic, interactive curve displays.
                            </p>
                        </div>

                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                            <div className="text-4xl mb-4">🔗</div>
                            <h3 className="text-xl font-semibold text-white mb-2">
                                Multi-Chain Support
                            </h3>
                            <p className="text-slate-400">
                                Import and manage positions across Ethereum, Arbitrum, and Base networks.
                            </p>
                        </div>
                    </div>

                    {/* Call to Action */}
                    <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-xl border border-blue-500/20 p-8 text-center">
                        <h3 className="text-2xl font-bold text-white mb-4">
                            Ready to optimize your DeFi strategy?
                        </h3>
                        <p className="text-slate-300 mb-6">
                            Join Midcurve and take control of your Uniswap V3 liquidity positions.
                        </p>
                        <Link
                            href="/?modal=signup"
                            className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                        >
                            Create Account
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
