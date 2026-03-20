/**
 * Operator Key Service
 *
 * Manages a single operator signing key for all automated order executions.
 * Replaces the per-user AutomationWalletService with a singleton operator model.
 *
 * On first startup: creates a KMS key, persists keyId to Settings table.
 * On subsequent startups: loads existing keyId from Settings, restores key.
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
  private initialized = false;

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
   * Initialize the operator key.
   * Idempotent — safe to call multiple times.
   *
   * Must be called on signer startup before any signing operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const existingKeyId = await this.settingService.get(SETTING_OPERATOR_KEY_ID);

    if (existingKeyId) {
      // Load existing operator key
      this.operatorKeyId = existingKeyId;

      // For LocalDevSigner, also restore the encrypted private key
      if (shouldUseLocalKeys()) {
        const encryptedPk = await this.settingService.get(SETTING_OPERATOR_ENCRYPTED_PK);
        if (encryptedPk) {
          (this.signer as unknown as LocalDevSigner).loadKey(existingKeyId, encryptedPk);
        }
      }

      this.operatorAddress = await this.signer.getAddress(existingKeyId);

      this.logger.info({
        operatorAddress: this.operatorAddress,
        keyId: existingKeyId,
        msg: 'Loaded existing operator key from settings',
      });
    } else {
      // Create new operator key
      const result = await this.signer.createKey('midcurve-operator');

      this.operatorKeyId = result.keyId;
      this.operatorAddress = result.walletAddress;

      // Persist to Settings table
      const settings: Record<string, string> = {
        [SETTING_OPERATOR_KEY_ID]: result.keyId,
      };

      if (result.encryptedPrivateKey) {
        settings[SETTING_OPERATOR_ENCRYPTED_PK] = result.encryptedPrivateKey;
      }

      await this.settingService.setMany(settings);

      this.logger.info({
        operatorAddress: this.operatorAddress,
        keyId: result.keyId,
        msg: 'Created new operator key and persisted to settings',
      });
    }

    this.initialized = true;
  }

  /**
   * Get the operator's Ethereum address.
   * Used as feeRecipient in executeOrder transactions.
   */
  getOperatorAddress(): Address {
    if (!this.operatorAddress) {
      throw new Error('OperatorKeyService not initialized. Call initialize() first.');
    }
    return this.operatorAddress;
  }

  /**
   * Get the operator key ID (internal use).
   */
  getOperatorKeyId(): string {
    if (!this.operatorKeyId) {
      throw new Error('OperatorKeyService not initialized. Call initialize() first.');
    }
    return this.operatorKeyId;
  }

  /**
   * Sign a transaction hash with the operator key.
   */
  async signTransaction(txHash: Hash): Promise<{ r: Hex; s: Hex; v: number; signature: Hex }> {
    const keyId = this.getOperatorKeyId();
    return this.signer.signTransaction(keyId, txHash);
  }
}
