/**
 * UniswapV3VaultShareOwnerBadge - Displays the vault share owner
 *
 * Own wallet: Botts icon only (hover shows full address).
 * Other wallet: truncated address only (no icon).
 * Uses the ownerWallet DB field (format: "evm:0x...").
 */

import { WalletAvatar } from "@/components/ui/wallet-avatar";
import { parseOwnerWallet, compareAddresses } from "@midcurve/shared";
import { useUserWallets } from "@/hooks/wallets/useWallets";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";

interface UniswapV3VaultShareOwnerBadgeProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultShareOwnerBadge({ position }: UniswapV3VaultShareOwnerBadgeProps) {
  const ownerWallet = (position as UniswapV3VaultPositionData & { ownerWallet?: string | null }).ownerWallet;
  const { data: walletsData } = useUserWallets();
  if (!ownerWallet) return null;

  const { address } = parseOwnerWallet(ownerWallet);

  const isOwnWallet = walletsData?.wallets.some((w) => {
    const walletAddress = w.walletHash.split("/")[1];
    return walletAddress && compareAddresses(walletAddress, address) === 0;
  });

  if (isOwnWallet) {
    return (
      <span className="text-[10px] md:text-xs text-slate-400 flex items-center" title={address}>
        <WalletAvatar address={address} size={16} />
      </span>
    );
  }

  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return (
    <span className="text-[10px] md:text-xs text-slate-400 flex items-center">
      {truncated}
    </span>
  );
}
