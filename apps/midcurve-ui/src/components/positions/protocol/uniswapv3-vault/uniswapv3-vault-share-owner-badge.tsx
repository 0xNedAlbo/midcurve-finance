/**
 * UniswapV3VaultShareOwnerBadge - Displays the vault share owner with avatar
 *
 * Shows a small WalletAvatar and truncated owner address.
 * Uses the ownerWallet DB field (format: "evm:0x...").
 */

import { WalletAvatar } from "@/components/ui/wallet-avatar";
import { parseOwnerWallet } from "@midcurve/shared";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";

interface UniswapV3VaultShareOwnerBadgeProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultShareOwnerBadge({ position }: UniswapV3VaultShareOwnerBadgeProps) {
  const ownerWallet = (position as UniswapV3VaultPositionData & { ownerWallet?: string | null }).ownerWallet;
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
