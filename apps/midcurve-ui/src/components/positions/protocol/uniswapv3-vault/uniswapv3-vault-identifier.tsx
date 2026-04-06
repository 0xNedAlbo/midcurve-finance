/**
 * UniswapV3VaultIdentifier - Vault address with block explorer link
 *
 * Displays the vault contract address inline with copy functionality and explorer link.
 */

"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { getExplorerBaseUrl, getExplorerName } from "@midcurve/shared";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type { UniswapV3VaultPositionConfigResponse } from "@midcurve/api-shared";

interface UniswapV3VaultIdentifierProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultIdentifier({ position }: UniswapV3VaultIdentifierProps) {
  const [copied, setCopied] = useState(false);

  const config = position.config as UniswapV3VaultPositionConfigResponse;

  const truncatedAddress = `${config.vaultAddress.slice(0, 6)}...${config.vaultAddress.slice(-4)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(config.vaultAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const explorerBaseUrl = getExplorerBaseUrl(config.chainId);
  const explorerDisplayName = getExplorerName(config.chainId);
  const explorerUrl = explorerBaseUrl
    ? `${explorerBaseUrl}/address/${config.vaultAddress}`
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
          title={`View on ${explorerDisplayName || "block explorer"}`}
        >
          {truncatedAddress}
        </a>
        <button
          onClick={handleCopy}
          className="p-0.5 hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
          title="Copy vault address"
        >
          {copied ? (
            <div className="text-green-400 text-[10px] md:text-xs">&#10003;</div>
          ) : (
            <Copy className="w-2.5 h-2.5 md:w-3 md:h-3 text-slate-400 hover:text-slate-300" />
          )}
        </button>
      </span>
    </>
  );
}
