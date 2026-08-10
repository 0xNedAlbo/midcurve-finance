/**
 * User Wallet Input Types
 *
 * Input types for UserWallet CRUD operations.
 * Service-layer only — not shared with UI/API.
 */

export interface CreateUserWalletInput {
  userId: string;
  walletType: string; // 'evm' — the only accepted value; see UserWallet.walletType in schema.prisma
  address: string; // Raw address — service builds walletHash and config
  label?: string;
  isPrimary?: boolean;
}

export interface UpdateUserWalletInput {
  label?: string;
  isPrimary?: boolean;
}
