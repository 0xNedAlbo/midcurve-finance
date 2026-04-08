/**
 * UniswapV3OwnerBadge - Displays the position owner wallet with avatar
 *
 * Shows a small WalletAvatar and truncated owner address.
 * Uses the ownerWallet DB field (format: "evm:0x...") rather than state.ownerAddress.
 */

import { WalletAvatar } from "@/components/ui/wallet-avatar";
import { parseOwnerWallet } from "@midcurve/shared";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";

interface UniswapV3OwnerBadgeProps {
  position: UniswapV3PositionData;
}

export function UniswapV3OwnerBadge({ position }: UniswapV3OwnerBadgeProps) {
  const ownerWallet = (position as UniswapV3PositionData & { ownerWallet?: string | null }).ownerWallet;
  if (!ownerWallet) return null;

  const { address } = parseOwnerWallet(ownerWallet);
  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <span className="text-[10px] md:text-xs text-slate-400 flex items-center gap-1">
      <WalletAvatar address={address} size={16} />
      {truncated}
    </span>
  );
}
