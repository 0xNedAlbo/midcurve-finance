import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { bottts } from "@dicebear/collection";
import { keccak256, toHex } from "viem";

interface WalletAvatarProps {
  address: string;
  size?: number;
  className?: string;
}

export function WalletAvatar({ address, size = 32, className = "" }: WalletAvatarProps) {
  const avatarDataUri = useMemo(() => {
    const seed = keccak256(toHex(address.toLowerCase()));
    return createAvatar(bottts, {
      seed,
      size,
      radius: 50,
      randomizeIds: true,
    }).toDataUri();
  }, [address, size]);

  return (
    <img
      src={avatarDataUri}
      alt="Wallet avatar"
      width={size}
      height={size}
      className={`rounded-full ${className}`}
    />
  );
}
