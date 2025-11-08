/**
 * Test Wallet Utilities
 *
 * Provides utilities for signing messages and transactions with a deterministic test wallet.
 * Uses the standard Hardhat/Foundry test mnemonic for reproducible testing.
 *
 * WARNING: These keys are PUBLIC and should NEVER be used on mainnet or with real funds!
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, type WalletClient, type Address } from 'viem';
import { mainnet } from 'viem/chains';

/**
 * Standard test mnemonic used by Hardhat/Foundry
 * This is PUBLIC and should only be used for testing!
 */
export const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

/**
 * First account derived from test mnemonic
 * Derivation path: m/44'/60'/0'/0/0
 */
export const TEST_WALLET_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_WALLET_ADDRESS: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

/**
 * Creates a viem account from the test private key
 */
export function createTestAccount() {
  return privateKeyToAccount(TEST_WALLET_PRIVATE_KEY);
}

/**
 * Creates a viem wallet client for the test account
 */
export function createTestWalletClient(): WalletClient {
  const account = createTestAccount();

  return createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });
}

/**
 * Signs a message with the test wallet
 * This is used for SIWE (Sign-In with Ethereum) authentication
 *
 * @param message - The message to sign (SIWE message string)
 * @returns The signature as a hex string
 */
export async function signMessageWithTestWallet(message: string): Promise<string> {
  const account = createTestAccount();
  const signature = await account.signMessage({ message });
  return signature;
}

/**
 * Gets the test wallet address
 * Useful for assertions and API calls
 */
export function getTestWalletAddress(): Address {
  return TEST_WALLET_ADDRESS;
}

/**
 * Creates a SIWE message for testing
 * This matches the format expected by the API
 *
 * @param nonce - The nonce from the API
 * @param options - Additional SIWE message options
 */
export function createSiweMessage(
  nonce: string,
  options?: {
    domain?: string;
    uri?: string;
    chainId?: number;
    statement?: string;
  }
): string {
  const domain = options?.domain || 'localhost:3000';
  const uri = options?.uri || 'http://localhost:3000';
  const chainId = options?.chainId || 1;
  const statement = options?.statement || 'Sign in to Midcurve Finance';
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

  // Format according to EIP-4361
  return `${domain} wants you to sign in with your Ethereum account:
${TEST_WALLET_ADDRESS}

${statement}

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;
}
