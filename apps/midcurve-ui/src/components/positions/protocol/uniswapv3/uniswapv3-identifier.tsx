/**
 * UniswapV3Identifier - NFT ID with block explorer link
 *
 * Displays the Uniswap V3 NFT ID inline with copy functionality and Etherscan link.
 */

"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import type { ListPositionData } from "@midcurve/api-shared";

// Chain ID to block explorer mapping
const BLOCK_EXPLORERS: Record<number, { name: string; url: string }> = {
  1: { name: "Etherscan", url: "https://etherscan.io" },
  42161: { name: "Arbiscan", url: "https://arbiscan.io" },
  8453: { name: "Basescan", url: "https://basescan.org" },
  56: { name: "BscScan", url: "https://bscscan.com" },
  137: { name: "Polygonscan", url: "https://polygonscan.com" },
  10: { name: "Optimistic Etherscan", url: "https://optimistic.etherscan.io" },
};

// Uniswap V3 NonfungiblePositionManager addresses (same on all chains)
const NFTPM_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

interface UniswapV3IdentifierProps {
  position: ListPositionData;
}

export function UniswapV3Identifier({ position }: UniswapV3IdentifierProps) {
  const [copied, setCopied] = useState(false);

  const config = position.config as {
    chainId: number;
    nftId: number;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config.nftId.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy NFT ID:", error);
    }
  };

  const explorer = BLOCK_EXPLORERS[config.chainId];
  const explorerUrl = explorer
    ? `${explorer.url}/token/${NFTPM_ADDRESS}?a=${config.nftId}`
    : undefined;

  return (
    <>
      <span className="hidden md:inline">•</span>
      <span className="flex items-center gap-0.5 md:gap-1">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline cursor-pointer text-[10px] md:text-xs"
          title={`View on ${explorer?.name || "block explorer"}`}
        >
          #{config.nftId}
        </a>
        <button
          onClick={handleCopy}
          className="p-0.5 hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
          title="Copy NFT ID"
        >
          {copied ? (
            <div className="text-green-400 text-[10px] md:text-xs">✓</div>
          ) : (
            <Copy className="w-2.5 h-2.5 md:w-3 md:h-3 text-slate-400 hover:text-slate-300" />
          )}
        </button>
      </span>
    </>
  );
}
