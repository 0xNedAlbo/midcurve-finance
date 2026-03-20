/**
 * Operator Key Service
 *
 * Manages a single operator signing key for all automated order executions.
 *
 * Key lifecycle:
 * - Creation: via createOperatorKey() called by the automation service on startup
 * - Loading: lazy, on first access (getOperatorAddress / signTransaction)
 * - Persistence: keyId stored in Settings table
 *
 * The operator account is self-funded with ETH and recovers gas costs
 * via the feeRecipient/feeBps mechanism in UniswapV3PositionCloser.
 */

import type { Address, Hex, Hash } from 'viem';
import { signerLogger } from '@/lib/logger';
import { getSigner, shouldUseLocalKeys, type EvmSigner, type LocalDevSigner } from '@/lib/kms';
import { SettingService } from '@midcurve/services';

// =============================================================================
// Constants
// =============================================================================

const SETTING_OPERATOR_KEY_ID = 'operator.kms.keyId';
const SETTING_OPERATOR_ENCRYPTED_PK = 'operator.kms.encryptedPrivateKey';
const SETTING_OPERATOR_ADDRESS = 'operator.address';

// =============================================================================
// Service
// =============================================================================

export class OperatorKeyService {
  private static instance: OperatorKeyService | null = null;

  private readonly logger = signerLogger.child({ service: 'OperatorKeyService' });
  private readonly settingService: SettingService;
  private readonly signer: EvmSigner;

  private operatorKeyId: string | null = null;
  private operatorAddress: Address | null = null;
  private loaded = false;

  constructor(dependencies: { settingService?: SettingService } = {}) {
    this.settingService = dependencies.settingService ?? SettingService.getInstance();
    this.signer = getSigner();
  }

  static getInstance(): OperatorKeyService {
    if (!OperatorKeyService.instance) {
      OperatorKeyService.instance = new OperatorKeyService();
    }
    return OperatorKeyService.instance;
  }

  static resetInstance(): void {
    OperatorKeyService.instance = null;
  }

  /**
   * Lazy-load an existing operator key from Settings.
   * Called internally before any access. Does nothing if already loaded.
   * If no key exists in Settings, the service stays unloaded — callers
   * must use createOperatorKey() first.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    const existingKeyId = await this.settingService.get(SETTING_OPERATOR_KEY_ID);
    if (!existingKeyId) return; // No key yet — createOperatorKey() must be called

    this.operatorKeyId = existingKeyId;

    // For LocalDevSigner, also restore the encrypted private key
    if (shouldUseLocalKeys()) {
      const encryptedPk = await this.settingService.get(SETTING_OPERATOR_ENCRYPTED_PK);
      if (encryptedPk) {
        (this.signer as unknown as LocalDevSigner).loadKey(existingKeyId, encryptedPk);
      }
    }

    this.operatorAddress = await this.signer.getAddress(existingKeyId);
    this.loaded = true;

    // Backfill operator.address if not yet persisted (migration for existing keys)
    const existingAddress = await this.settingService.get(SETTING_OPERATOR_ADDRESS);
    if (!existingAddress) {
      await this.settingService.set(SETTING_OPERATOR_ADDRESS, this.operatorAddress);
    }

    this.logger.info({
      operatorAddress: this.operatorAddress,
      keyId: existingKeyId,
      msg: 'Loaded existing operator key from settings',
    });
  }

  /**
   * Create the operator key (or load it if it already exists).
   * Idempotent — safe to call on every automation startup.
   *
   * @returns The operator's Ethereum address
   */
  async createOperatorKey(): Promise<Address> {
    await this.ensureLoaded();

    // Already exists — return the address
    if (this.operatorAddress) {
      return this.operatorAddress;
    }

    // Create new operator key
    const result = await this.signer.createKey('midcurve-operator');

    this.operatorKeyId = result.keyId;
    this.operatorAddress = result.walletAddress;

    // Persist to Settings table
    const settings: Record<string, string> = {
      [SETTING_OPERATOR_KEY_ID]: result.keyId,
      [SETTING_OPERATOR_ADDRESS]: result.walletAddress,
    };

    if (result.encryptedPrivateKey) {
      settings[SETTING_OPERATOR_ENCRYPTED_PK] = result.encryptedPrivateKey;
    }

    await this.settingService.setMany(settings);
    this.loaded = true;

    this.logger.info({
      operatorAddress: this.operatorAddress,
      keyId: result.keyId,
      msg: 'Created new operator key and persisted to settings',
    });

    return this.operatorAddress;
  }

  /**
   * Get the operator's Ethereum address.
   * Lazy-loads from Settings on first call.
   * Throws if no operator key has been created yet.
   */
  async getOperatorAddress(): Promise<Address> {
    await this.ensureLoaded();
    if (!this.operatorAddress) {
      throw new Error('Operator wallet not created yet. Call POST /api/operator/wallet first.');
    }
    return this.operatorAddress;
  }

  /**
   * Check whether the operator key is available.
   */
  async isInitialized(): Promise<boolean> {
    await this.ensureLoaded();
    return this.operatorAddress !== null;
  }

  /**
   * Get the operator key ID (internal use).
   */
  private getOperatorKeyId(): string {
    if (!this.operatorKeyId) {
      throw new Error('Operator wallet not created yet. Call POST /api/operator/wallet first.');
    }
    return this.operatorKeyId;
  }

  /**
   * Sign a transaction hash with the operator key.
   */
  async signTransaction(txHash: Hash): Promise<{ r: Hex; s: Hex; v: number; signature: Hex }> {
    await this.ensureLoaded();
    const keyId = this.getOperatorKeyId();
    return this.signer.signTransaction(keyId, txHash);
  }
}
