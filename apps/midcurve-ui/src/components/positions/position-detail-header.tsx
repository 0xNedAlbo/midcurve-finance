/**
 * Position Detail Header - Protocol-Agnostic
 *
 * Header component for position detail pages with:
 * - Token logos and pair name
 * - Status badges
 * - Protocol-specific metadata (via slots)
 * - Back navigation
 * - Refresh button
 * - Action buttons
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, RefreshCw, Copy, ExternalLink } from "lucide-react";
import { formatProtocolName } from "@/lib/format-helpers";
import { getDashboardUrl } from "@/lib/dashboard-referrer";

interface PositionDetailHeaderProps {
  // Token information
  token0Symbol: string;
  token1Symbol: string;
  token0LogoUrl?: string;
  token1LogoUrl?: string;

  // Status
  status: "active" | "closed" | "archived" | "liquidated";
  isInRange?: boolean; // Optional - for active positions

  // Chain/Protocol info
  chainMetadata: {
    shortName: string;
    explorer: string;
  };
  protocol: string;

  // Refresh functionality
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;

  // Optional metadata slots (protocol-specific)
  feeTierDisplay?: React.ReactNode;
  identifierDisplay?: React.ReactNode;

  // Optional explorer link (protocol-specific)
  explorerUrl?: string;
  explorerLabel?: string;

  // Last updated timestamp
  updatedAt?: string;
}

export function PositionDetailHeader({
  token0Symbol,
  token1Symbol,
  token0LogoUrl,
  token1LogoUrl,
  status,
  isInRange,
  chainMetadata,
  protocol,
  onRefresh,
  isRefreshing,
  feeTierDisplay,
  identifierDisplay,
  explorerUrl,
  explorerLabel = "NFT",
  updatedAt,
}: PositionDetailHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case "active":
        return "text-green-400 bg-green-500/10 border-green-500/20";
      case "closed":
        return "text-slate-400 bg-slate-500/10 border-slate-500/20";
      case "liquidated":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      case "archived":
        return "text-slate-400 bg-slate-500/10 border-slate-500/20";
      default:
        return "text-slate-400 bg-slate-500/10 border-slate-500/20";
    }
  };

  const getRangeStatusColor = () => {
    if (status !== "active") return null;
    return isInRange
      ? "text-green-400 bg-green-500/10 border-green-500/20"
      : "text-red-400 bg-red-500/10 border-red-500/20";
  };

  const getStatusText = (s: string) => {
    switch (s) {
      case "active":
        return "Active";
      case "closed":
        return "Closed";
      case "archived":
        return "Archived";
      case "liquidated":
        return "Liquidated";
      default:
        return "Unknown";
    }
  };

  const rangeStatusColor = getRangeStatusColor();

  return (
    <div className="mb-8">
      {/* Back Navigation */}
      <div className="mb-6">
        <Link
          href={getDashboardUrl()}
          className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>

      {/* Main Header */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 px-8 py-6">
        <div className="flex items-start justify-between">
          {/* Left Side - Token Info */}
          <div className="flex items-center gap-6">
            {/* Token Logos */}
            <div className="flex items-center -space-x-3">
              <Image
                src={token0LogoUrl || "/images/tokens/default.png"}
                alt={token0Symbol}
                width={48}
                height={48}
                className="w-12 h-12 rounded-full border-3 border-slate-800 bg-slate-700 z-10"
              />
              <Image
                src={token1LogoUrl || "/images/tokens/default.png"}
                alt={token1Symbol}
                width={48}
                height={48}
                className="w-12 h-12 rounded-full border-3 border-slate-800 bg-slate-700"
              />
            </div>

            {/* Position Info */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-white">
                  {token0Symbol}/{token1Symbol}
                </h1>
                <span
                  className={`px-3 py-1 rounded-lg text-sm font-medium border ${getStatusColor(
                    status
                  )}`}
                >
                  {getStatusText(status)}
                </span>
                {rangeStatusColor && (
                  <span
                    className={`px-3 py-1 rounded-lg text-sm font-medium border ${rangeStatusColor}`}
                  >
                    {isInRange ? "In Range" : "Out of Range"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-slate-400">
                {/* Chain */}
                <span className="px-2 py-1 rounded bg-slate-500/20 border border-slate-500/30 text-slate-300">
                  {chainMetadata.shortName}
                </span>

                {/* Protocol */}
                <span>{formatProtocolName(protocol)}</span>

                {/* Fee Tier (if provided) */}
                {feeTierDisplay && (
                  <>
                    <span>•</span>
                    {feeTierDisplay}
                  </>
                )}

                {/* Identifier (if provided) */}
                {identifierDisplay && (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-2">
                      {identifierDisplay}
                      {explorerUrl && (
                        <>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                explorerUrl.split("/").pop() || ""
                              )
                            }
                            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                            title="Copy ID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                            title={`View ${explorerLabel} on Explorer`}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                      {copied && (
                        <div className="absolute mt-8 bg-green-600 text-white text-xs px-2 py-1 rounded shadow-lg z-20">
                          Copied!
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Side - Actions */}
          <div className="flex items-center gap-3">
            {/* Last Updated */}
            {updatedAt && (
              <div className="text-right text-sm text-slate-400">
                <div>Last Updated</div>
                <div>{new Date(updatedAt).toLocaleString()}</div>
              </div>
            )}

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-3 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              title="Refresh"
            >
              <RefreshCw
                className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
