/**
 * UniswapV3 Close Order Service
 *
 * Provides CRUD operations, lifecycle management, and on-chain integration
 * for UniswapV3 close orders (both NFT and vault positions).
 *
 * Key concepts:
 * - protocol: 'uniswapv3' (NFT) or 'uniswapv3-vault' (vault shares)
 * - config: immutable identity data (JSON)
 *     NFT:   { chainId, nftId, triggerMode, contractAddress }
 *     Vault: { chainId, vaultAddress, ownerAddress, triggerMode, contractAddress }
 * - state: mutable on-chain state (JSON) — triggerTick, pool, slippage, etc.
 * - orderIdentityHash: unique identifier
 *     NFT:   "uniswapv3/{chainId}/{nftId}/{triggerMode}"
 *     Vault: "uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}/{triggerMode}"
 * - automationState: single lifecycle field (inactive|monitoring|executing|retrying|failed|executed)
 *     inactive = stored for display only, operator is not our automation wallet
 * - executionAttempts: retry counter, resets when price moves away from trigger
 *
 * DB lifecycle driven by on-chain events:
 * - OrderRegistered → INSERT (automationState=monitoring if we are operator, inactive otherwise)
 * - OrderCancelled → DELETE
 * - OrderExecuted → UPDATE automationState=executed
 * - Re-registration at same slot → DELETE old, INSERT new
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { CloseOrder, Prisma } from '@midcurve/database';
import { ContractTriggerMode, OnChainOrderStatus, compareAddresses } from '@midcurve/shared';
import type { ContractSwapDirection, SharedContractName } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import { EvmConfig } from '../../config/evm.js';
import { deriveCloseOrderHashFromTick } from '../../utils/automation/close-order-hash.js';
import { createCloseOrderIdentityHash } from '../../utils/automation/close-order-identity.js';
import { SharedContractService } from '../automation/shared-contract-service.js';
import type {
  CreateCloseOrderInput,
  SyncFromChainInput,
  FindCloseOrderOptions,
} from '../types/automation/index.js';

// ============================================================================
// ABI (minimal — only getOrder)
// ============================================================================

const POSITION_CLOSER_GET_ORDER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'nftId', type: 'uint256' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
    ],
    name: 'getOrder',
    outputs: [
      {
        internalType: 'struct CloseOrder',
        name: 'order',
        type: 'tuple',
        components: [
          { internalType: 'enum OrderStatus', name: 'status', type: 'uint8' },
          { internalType: 'uint256', name: 'nftId', type: 'uint256' },
          { internalType: 'address', name: 'owner', type: 'address' },
          { internalType: 'address', name: 'pool', type: 'address' },
          { internalType: 'int24', name: 'triggerTick', type: 'int24' },
          { internalType: 'address', name: 'payout', type: 'address' },
          { internalType: 'address', name: 'operator', type: 'address' },
          { internalType: 'uint256', name: 'validUntil', type: 'uint256' },
          { internalType: 'uint16', name: 'slippageBps', type: 'uint16' },
          { internalType: 'enum SwapDirection', name: 'swapDirection', type: 'uint8' },
          { internalType: 'uint16', name: 'swapSlippageBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * VaultPositionCloser ABI (minimal — only getOrder for vault orders)
 *
 * getOrder(address vault, address owner, uint8 triggerMode) → VaultCloseOrder
 */
const VAULT_POSITION_CLOSER_GET_ORDER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'vault', type: 'address' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
    ],
    name: 'getOrder',
    outputs: [
      {
        internalType: 'struct VaultCloseOrder',
        name: 'order',
        type: 'tuple',
        components: [
          { internalType: 'enum OrderStatus', name: 'status', type: 'uint8' },
          { internalType: 'address', name: 'vault', type: 'address' },
          { internalType: 'address', name: 'owner', type: 'address' },
          { internalType: 'address', name: 'pool', type: 'address' },
          { internalType: 'uint256', name: 'shares', type: 'uint256' },
          { internalType: 'int24', name: 'triggerTick', type: 'int24' },
          { internalType: 'address', name: 'payout', type: 'address' },
          { internalType: 'address', name: 'operator', type: 'address' },
          { internalType: 'uint256', name: 'validUntil', type: 'uint256' },
          { internalType: 'uint16', name: 'slippageBps', type: 'uint16' },
          { internalType: 'enum SwapDirection', name: 'swapDirection', type: 'uint8' },
          { internalType: 'uint16', name: 'swapSlippageBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============================================================================
// Types
// ============================================================================

/**
 * On-chain order data returned by getOrder().
 * Only populated when status !== NONE.
 */
interface OnChainOrder {
  status: number;
  owner: string;
  pool: string;
  triggerTick: number;
  payout: string;
  operator: string;
  validUntil: bigint;
  slippageBps: number;
  swapDirection: ContractSwapDirection;
  swapSlippageBps: number;
  // NFT-specific
  nftId?: bigint;
  // Vault-specific
  vault?: string;
  shares?: bigint;
}

/**
 * Dependencies for UniswapV3CloseOrderService
 */
export interface UniswapV3CloseOrderServiceDependencies {
  prisma?: PrismaClient;
  sharedContractService?: SharedContractService;
}

/**
 * CloseOrder with position included.
 * Used by price monitor for subscription sync.
 * Pool data (chainId, poolAddress) is in position.config JSON.
 */
export interface CloseOrderWithPosition extends CloseOrder {
  position: {
    id: string;
    config: Prisma.JsonValue;
  };
}

/**
 * Result of discover() — returns discovered orders and counts.
 */
export interface DiscoverCloseOrdersResult {
  /** All close orders for the position (existing + newly discovered) */
  orders: CloseOrder[];
  /** Number of new orders discovered from on-chain */
  discovered: number;
  /** Number of orders already tracked in DB */
  existing: number;
}

/**
 * Result of refresh() — all orders after reconciliation with on-chain state.
 */
export interface RefreshCloseOrdersResult {
  /** All close orders for the position after reconciliation */
  orders: CloseOrder[];
  /** Number of new orders created from on-chain */
  created: number;
  /** Number of existing orders updated from on-chain */
  updated: number;
  /** Number of stale orders deleted (no longer active on-chain) */
  deleted: number;
}

/**
 * One trigger slot as read from the closer contract.
 * `onChain` is null when the contract reports no order in that slot.
 */
export interface CloseOrderChainSlot {
  triggerMode: ContractTriggerMode;
  onChain: OnChainOrder | null;
  orderIdentityHash: string;
}

/**
 * Everything {@link UniswapV3CloseOrderService.reconcileChainSnapshot} needs to
 * write, read once by {@link UniswapV3CloseOrderService.fetchChainSnapshot}.
 *
 * Exists so the RPC reads can happen before a write transaction is opened
 * rather than inside it.
 */
export interface CloseOrderChainSnapshot {
  positionId: string;
  /** 'uniswapv3' (NFT) or 'uniswapv3-vault' (vault shares) */
  protocol: string;
  chainId: number;
  isVault: boolean;
  /** Closer contract the slots were read from */
  contractAddress: string;
  /** NFT positions only */
  nftId?: string;
  /** Vault positions only */
  vaultAddress?: string;
  /** Vault positions only */
  ownerAddress?: string;
  /** Whether an operator key is configured at all */
  hasOperator: boolean;
  /** Our operator address, or null when unconfigured */
  ourOperatorAddress: string | null;
  /** One entry per trigger mode (LOWER, UPPER) */
  slots: CloseOrderChainSlot[];
}

/**
 * Outcome of {@link UniswapV3CloseOrderService.fetchChainSnapshot}.
 *
 * `unavailable` exists so that "this chain has no closer contract registered"
 * — a fact, readable from the database — stops being discovered by throwing.
 * It used to be an exception, which forced callers into a catch that then hid
 * RPC outages and defects along with it (#86).
 *
 * Everything else still throws: an outage, a malformed position, a missing
 * position. Those are not states, and the caller is not meant to continue.
 */
/** A closer contract located for a chain. */
export interface ResolvedCloserContract {
  contractName: string;
  address: string;
}

export type CloseOrderChainRead =
  | { status: 'ok'; snapshot: CloseOrderChainSnapshot }
  | {
      status: 'unavailable';
      reason: 'no-closer-contract';
      chainId: number;
      contractName: string;
    };

// ============================================================================
// Service
// ============================================================================

export class UniswapV3CloseOrderService {
  private readonly prisma: PrismaClient;
  private readonly sharedContractService: SharedContractService;
  private readonly logger: ServiceLogger;

  /** Supported protocols: 'uniswapv3' (NFT) and 'uniswapv3-vault' (vault shares) */
  static readonly SUPPORTED_PROTOCOLS = ['uniswapv3', 'uniswapv3-vault'] as const;

  constructor(dependencies: UniswapV3CloseOrderServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.sharedContractService = dependencies.sharedContractService ?? new SharedContractService();
    this.logger = createServiceLogger('UniswapV3CloseOrderService');
  }

  // ==========================================================================
  // DISCOVERY & REFRESH (to be implemented)
  // ==========================================================================

  /**
   * Discover close orders for a position from on-chain data.
   *
   * Thin wrapper around refresh() that uses blockNumber='latest'.
   * Preserves the DiscoverCloseOrdersResult interface for backward compatibility.
   */
  async discover(
    positionId: string,
    tx?: PrismaTransactionClient,
  ): Promise<DiscoverCloseOrdersResult> {
    const result = await this.refresh(positionId, 'latest', tx);
    return {
      orders: result.orders,
      discovered: result.created,
      existing: result.updated,
    };
  }

  /**
   * The closer contract name for a protocol. One place, so the NFT and vault
   * paths cannot drift apart on what they are looking for.
   */
  static closerContractName(protocol: string): SharedContractName {
    return (
      protocol === 'uniswapv3-vault'
        ? 'UniswapV3VaultPositionCloser'
        : 'UniswapV3PositionCloser'
    ) as SharedContractName;
  }

  /**
   * Resolve the closer contract for a chain, or null when none is registered.
   *
   * Null is an answer, not a failure — see {@link CloseOrderChainRead}. Callers
   * that need the address for something else as well (the vault refresh reads
   * the closer's event logs) resolve it once here and hand the result to
   * {@link fetchChainSnapshot}, so there is a single lookup with a single
   * reaction to it rather than two that react differently.
   */
  async resolveCloserContract(
    chainId: number,
    protocol: string,
  ): Promise<ResolvedCloserContract | null> {
    const contractName = UniswapV3CloseOrderService.closerContractName(protocol);
    const sharedContract = await this.sharedContractService.findLatestByChainAndName(
      chainId,
      contractName,
    );
    if (!sharedContract) return null;
    return { contractName, address: sharedContract.config.address };
  }

  /**
   * Read the on-chain close-order state for a position, without writing anything.
   *
   * This is the network half of {@link refresh}. It is public so that callers
   * running their own write transaction can do the RPC round-trips *before*
   * opening it, then pass the result to {@link reconcileChainSnapshot}. Holding
   * a transaction open across these reads is what made position refresh exceed
   * Prisma's interactive-transaction timeout.
   *
   * Returns a {@link CloseOrderChainRead}: `unavailable` when no closer is
   * registered for the chain, `ok` otherwise. Every other failure throws — an
   * RPC outage is not a state to be carried on with.
   *
   * @param positionId - Position ID to read close orders for
   * @param blockNumber - Block number to read state at, or 'latest'
   * @param tx - Transaction to run the *locating* reads in (position, operator
   *   config, closer contract). Pass this only when a transaction is already
   *   open and may hold rows this needs to see — the position row created
   *   earlier in the same transaction, for instance. Callers doing the
   *   fetch-then-write split leave it unset, which is the whole point: nothing
   *   is open while the RPC reads below run.
   * @param closer - Already-resolved closer contract, when the caller needed it
   *   for its own reasons. Omit to have it resolved here.
   */
  async fetchChainSnapshot(
    positionId: string,
    blockNumber: number | 'latest' = 'latest',
    tx?: PrismaTransactionClient,
    closer?: ResolvedCloserContract | null,
  ): Promise<CloseOrderChainRead> {
    log.methodEntry(this.logger, 'fetchChainSnapshot', { positionId, blockNumber });

    const db = tx ?? this.prisma;

    // 1. Fetch position to determine protocol and extract identifiers
    const position = await db.position.findUnique({ where: { id: positionId } });
    if (!position) {
      throw new Error(`Position not found: ${positionId}`);
    }
    const posConfig = position.config as Record<string, unknown>;
    const chainId = posConfig.chainId as number;
    const protocol = position.protocol; // 'uniswapv3' or 'uniswapv3-vault'
    const isVault = protocol === 'uniswapv3-vault';

    // Protocol-specific identifiers
    const nftId = isVault ? undefined : String(posConfig.nftId);
    const vaultAddress = isVault ? (posConfig.vaultAddress as string) : undefined;
    const ownerAddress = isVault ? (posConfig.ownerAddress as string) : undefined;

    if (isVault && (!vaultAddress || !ownerAddress)) {
      throw new Error(`Vault position missing vaultAddress or ownerAddress: ${positionId}`);
    }
    if (!isVault && !nftId) {
      throw new Error(`NFT position missing nftId: ${positionId}`);
    }

    // 2. Look up operator key + address from system config (single operator key)
    const operatorKeyId = await db.systemConfig.findUnique({ where: { key: 'operator.kms.keyId' } });
    const operatorAddressEntry = await db.systemConfig.findUnique({ where: { key: 'operator.address' } });
    const hasOperator = operatorKeyId !== null;
    const ourOperatorAddress = operatorAddressEntry?.value ?? null;

    // 3. Find the closer contract for this chain (protocol-specific).
    // Absent is a state, not an error: it means automation is not deployed on
    // this chain, which the caller reports rather than fails on.
    const resolved = closer ?? (await this.resolveCloserContract(chainId, protocol));
    if (!resolved) {
      const contractName = UniswapV3CloseOrderService.closerContractName(protocol);
      log.methodExit(this.logger, 'fetchChainSnapshot', { positionId, unavailable: true });
      return { status: 'unavailable', reason: 'no-closer-contract', chainId, contractName };
    }
    const contractAddress = resolved.address;

    // 4. Read both trigger modes from the chain, in parallel
    const triggerModes = [ContractTriggerMode.LOWER, ContractTriggerMode.UPPER] as const;

    const slots = await Promise.all(
      triggerModes.map(async (triggerMode) => {
        const onChain = isVault
          ? await this.readVaultOnChainOrder(
              chainId, contractAddress, vaultAddress!, ownerAddress!, triggerMode, blockNumber,
            )
          : await this.readOnChainOrder(
              chainId, contractAddress, BigInt(nftId!), triggerMode, blockNumber,
            );

        // Protocol-specific identity hash — shared with the on-chain event rule,
        // which is the other writer of these rows.
        const orderIdentityHash = isVault
          ? createCloseOrderIdentityHash({
              protocol: 'uniswapv3-vault',
              chainId,
              vaultAddress: vaultAddress!,
              ownerAddress: ownerAddress!,
              triggerMode,
            })
          : createCloseOrderIdentityHash({
              protocol: 'uniswapv3',
              chainId,
              nftId: nftId!,
              triggerMode,
            });

        return { triggerMode, onChain, orderIdentityHash };
      }),
    );

    log.methodExit(this.logger, 'fetchChainSnapshot', { positionId });

    return {
      status: 'ok',
      snapshot: {
        positionId,
        protocol,
        chainId,
        isVault,
        contractAddress,
        nftId,
        vaultAddress,
        ownerAddress,
        hasOperator,
        ourOperatorAddress,
        slots,
      },
    };
  }

  /**
   * Reconcile DB close-order rows against an already-read chain snapshot.
   *
   * This is the write half of {@link refresh} — pure database work, safe to run
   * inside a caller's transaction:
   * - Creates missing orders (exist on-chain but not in DB)
   * - Updates existing orders (syncs on-chain state, adjusts automationState)
   * - Deletes stale orders (no longer active on-chain)
   *
   * @param snapshot - Chain state from {@link fetchChainSnapshot}
   * @param tx - Optional Prisma transaction client
   */
  async reconcileChainSnapshot(
    snapshot: CloseOrderChainSnapshot,
    tx?: PrismaTransactionClient,
  ): Promise<RefreshCloseOrdersResult> {
    const { positionId, protocol, chainId, isVault, contractAddress, nftId } = snapshot;
    const { vaultAddress, ownerAddress, hasOperator, ourOperatorAddress } = snapshot;

    log.methodEntry(this.logger, 'reconcileChainSnapshot', { positionId });

    try {
      const db = tx ?? this.prisma;

      const orders: CloseOrder[] = [];
      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const { triggerMode, onChain, orderIdentityHash } of snapshot.slots) {
        const existingOrder = await this.findByOrderIdentityHash(orderIdentityHash, tx);
        const isActive = onChain !== null && onChain.status === OnChainOrderStatus.ACTIVE;

        if (isActive && !existingOrder) {
          // On-chain ACTIVE + no DB record → create
          const closeOrderHash = deriveCloseOrderHashFromTick(
            triggerMode,
            onChain.triggerTick,
          );
          // Mark as monitoring only if operator key is configured AND the on-chain
          // operator matches our operator address
          const isOurOrder = hasOperator && ourOperatorAddress !== null
            && compareAddresses(onChain.operator, ourOperatorAddress) === 0;

          // Build protocol-specific config and state
          const orderConfig = isVault
            ? { chainId, vaultAddress, ownerAddress, triggerMode, contractAddress }
            : { chainId, nftId, triggerMode, contractAddress };

          const orderState: Record<string, unknown> = {
            triggerTick: onChain.triggerTick,
            slippageBps: onChain.slippageBps,
            payoutAddress: onChain.payout,
            operatorAddress: onChain.operator,
            owner: onChain.owner,
            pool: onChain.pool,
            validUntil: new Date(Number(onChain.validUntil) * 1000).toISOString(),
            swapDirection: onChain.swapDirection,
            swapSlippageBps: onChain.swapSlippageBps,
            discoveredAt: new Date().toISOString(),
            ...(isVault && onChain.shares !== undefined ? { shares: onChain.shares.toString() } : {}),
          };

          const newOrder = await this.create(
            {
              protocol,
              positionId,
              orderIdentityHash,
              closeOrderHash,
              automationState: isOurOrder ? 'monitoring' : 'inactive',
              config: orderConfig,
              state: orderState,
            },
            tx,
          );

          orders.push(newOrder);
          created++;
        } else if (isActive && existingOrder) {
          // On-chain ACTIVE + DB record exists → update state
          const updatedState: Record<string, unknown> = {
            triggerTick: onChain.triggerTick,
            slippageBps: onChain.slippageBps,
            payoutAddress: onChain.payout,
            operatorAddress: onChain.operator,
            owner: onChain.owner,
            pool: onChain.pool,
            validUntil: new Date(Number(onChain.validUntil) * 1000).toISOString(),
            swapDirection: onChain.swapDirection,
            swapSlippageBps: onChain.swapSlippageBps,
            ...(isVault && onChain.shares !== undefined ? { shares: onChain.shares.toString() } : {}),
          };

          const synced = await this.syncFromChain(existingOrder.id, { state: updatedState }, tx);

          // Adjust automationState based on operator ownership.
          // Never touch in-flight execution states or failed (user must reactivate).
          const isOurOrder = hasOperator && ourOperatorAddress !== null
            && compareAddresses(onChain.operator, ourOperatorAddress) === 0;
          const currentState = existingOrder.automationState;

          if (currentState === 'executing' || currentState === 'retrying') {
            // In-flight execution — do not touch
          } else if (!isOurOrder && currentState !== 'inactive') {
            // Operator is not ours → inactive
            await db.closeOrder.update({
              where: { id: existingOrder.id },
              data: { automationState: 'inactive' },
            });
            this.logger.info(
              { id: existingOrder.id, from: currentState, to: 'inactive' },
              'Automation state set to inactive (operator not ours)',
            );
          } else if (isOurOrder && currentState === 'inactive') {
            // Operator changed to us → paused (don't auto-monitor)
            await db.closeOrder.update({
              where: { id: existingOrder.id },
              data: { automationState: 'paused' },
            });
            this.logger.info(
              { id: existingOrder.id, from: currentState, to: 'paused' },
              'Automation state set to paused (operator now ours)',
            );
          }
          // All other states (monitoring, paused, failed) when operator matches: no change

          orders.push(synced);
          updated++;
        } else if (!isActive && existingOrder) {
          // Not active on-chain + DB record exists → delete stale record
          this.logger.info(
            { id: existingOrder.id, triggerMode },
            'Order no longer active on-chain — deleting DB record',
          );
          await this.delete(existingOrder.id, tx);
          deleted++;
        }
        // Not active on-chain + no DB record → nothing to do
      }

      this.logger.info(
        { positionId, created, updated, deleted },
        'Close order refresh complete',
      );
      log.methodExit(this.logger, 'reconcileChainSnapshot', { created, updated, deleted });
      return { orders, created, updated, deleted };
    } catch (error) {
      log.methodError(this.logger, 'reconcileChainSnapshot', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Refresh all close orders for a position from on-chain data.
   *
   * Reads the PositionCloser contract for both trigger modes (LOWER, UPPER)
   * and reconciles DB state.
   *
   * Convenience composition of {@link fetchChainSnapshot} and
   * {@link reconcileChainSnapshot}. Callers that hold — or are about to open —
   * a write transaction should call those two directly instead, so the RPC
   * reads happen outside the transaction.
   *
   * @param positionId - Position ID to reconcile close orders for
   * @param blockNumber - Block number to read state at, or 'latest'
   * @param tx - Optional Prisma transaction client
   */
  async refresh(
    positionId: string,
    blockNumber: number | 'latest' = 'latest',
    tx?: PrismaTransactionClient,
  ): Promise<RefreshCloseOrdersResult> {
    // `tx` is threaded into the fetch as well so this keeps reading its own
    // caller's uncommitted writes, exactly as it did before the split.
    const read = await this.fetchChainSnapshot(positionId, blockNumber, tx);

    if (read.status === 'unavailable') {
      // No closer deployed on this chain, so there is nothing on-chain to
      // reconcile against and an empty result is true rather than assumed.
      // Any DB rows from an earlier registration are left alone — this is not
      // evidence they are stale.
      this.logger.warn(
        { positionId, chainId: read.chainId, contractName: read.contractName },
        'No closer contract registered for this chain — close-order automation unavailable',
      );
      return { orders: [], created: 0, updated: 0, deleted: 0 };
    }

    return this.reconcileChainSnapshot(read.snapshot, tx);
  }

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  /**
   * Creates a new close order record.
   * Called when an OrderRegistered event is received from the chain.
   */
  async create(
    input: CreateCloseOrderInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'create', {
      positionId: input.positionId,
      protocol: input.protocol,
      orderIdentityHash: input.orderIdentityHash,
    });

    try {
      const db = tx ?? this.prisma;

      const result = await db.closeOrder.create({
        data: {
          protocol: input.protocol,
          positionId: input.positionId,
          orderIdentityHash: input.orderIdentityHash,
          closeOrderHash: input.closeOrderHash,
          automationState: input.automationState ?? 'monitoring',
          config: input.config as Prisma.InputJsonValue,
          state: input.state as Prisma.InputJsonValue,
        },
      });

      this.logger.info(
        { id: result.id, positionId: result.positionId, protocol: result.protocol },
        'Close order created',
      );
      log.methodExit(this.logger, 'create', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Ensures the identity slot holds exactly this order.
   *
   * Registration is not "insert a row", it is "this slot now holds this order" —
   * so it is expressed as an upsert on the unique orderIdentityHash. Two writers
   * exist for these rows (the on-chain event rule and refresh()); whichever wins
   * the race, the slot ends up with the same content instead of one of them
   * failing on the unique constraint.
   */
  async upsertByIdentityHash(
    input: CreateCloseOrderInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'upsertByIdentityHash', {
      positionId: input.positionId,
      protocol: input.protocol,
      orderIdentityHash: input.orderIdentityHash,
    });

    try {
      const db = tx ?? this.prisma;

      const mutableFields = {
        positionId: input.positionId,
        closeOrderHash: input.closeOrderHash,
        automationState: input.automationState ?? 'monitoring',
        config: input.config as Prisma.InputJsonValue,
        state: input.state as Prisma.InputJsonValue,
      };

      const result = await db.closeOrder.upsert({
        where: { orderIdentityHash: input.orderIdentityHash },
        create: {
          protocol: input.protocol,
          orderIdentityHash: input.orderIdentityHash,
          ...mutableFields,
        },
        update: mutableFields,
      });

      this.logger.info(
        { id: result.id, positionId: result.positionId, protocol: result.protocol },
        'Close order slot ensured',
      );
      log.methodExit(this.logger, 'upsertByIdentityHash', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'upsertByIdentityHash', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds an order by ID.
   */
  async findById(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findUnique({ where: { id } });
  }

  /**
   * Finds an order by its unique identity hash.
   * E.g. "uniswapv3/1/12345/0" for UniswapV3 orders.
   */
  async findByOrderIdentityHash(
    orderIdentityHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findUnique({
      where: { orderIdentityHash },
    });
  }

  /**
   * Finds an order by position ID and close order hash.
   * URL-friendly lookup for API endpoints.
   * Uses @@unique([positionId, closeOrderHash]).
   */
  async findByPositionAndHash(
    positionId: string,
    closeOrderHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findUnique({
      where: {
        positionId_closeOrderHash: { positionId, closeOrderHash },
      },
    });
  }

  /**
   * Finds close orders by position ID with optional filters.
   */
  async findByPositionId(
    positionId: string,
    options: FindCloseOrderOptions = {},
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder[]> {
    const db = tx ?? this.prisma;
    const where = this.buildWhereClause({ ...options, positionId });

    return db.closeOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Finds all orders that are actively being monitored.
   * automationState=monitoring.
   * Includes position for subscription sync.
   */
  async findMonitoringOrders(
    options?: { protocols?: string[] },
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderWithPosition[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: {
        automationState: 'monitoring',
        ...(options?.protocols && { protocol: { in: options.protocols } }),
      },
      include: {
        position: {
          select: {
            id: true,
            config: true,
          },
        },
      },
    }) as Promise<CloseOrderWithPosition[]>;
  }

  /**
   * Gets distinct pools with actively monitoring orders.
   * Used for pool price subscription sync.
   * Pool data (chainId, poolAddress) is extracted from position.config JSON.
   */
  async getPoolsWithMonitoringOrders(
    options?: { protocols?: string[] },
    tx?: PrismaTransactionClient,
  ): Promise<Array<{ chainId: number; poolAddress: string }>> {
    log.methodEntry(this.logger, 'getPoolsWithMonitoringOrders', {});

    try {
      const db = tx ?? this.prisma;
      const orders = await db.closeOrder.findMany({
        where: {
          automationState: 'monitoring',
          ...(options?.protocols && { protocol: { in: options.protocols } }),
        },
        select: {
          position: {
            select: {
              config: true,
            },
          },
        },
      });

      const poolsMap = new Map<
        string,
        { chainId: number; poolAddress: string }
      >();

      for (const order of orders) {
        const positionConfig = order.position?.config as Record<string, unknown> | null;
        if (!positionConfig) continue;

        const chainId = positionConfig.chainId as number | undefined;
        const poolAddress = positionConfig.poolAddress as string | undefined;
        if (chainId && poolAddress) {
          const key = `${chainId}-${poolAddress.toLowerCase()}`;
          poolsMap.set(key, {
            chainId,
            poolAddress,
          });
        }
      }

      const pools = Array.from(poolsMap.values());
      log.methodExit(this.logger, 'getPoolsWithMonitoringOrders', {
        count: pools.length,
      });
      return pools;
    } catch (error) {
      log.methodError(
        this.logger,
        'getPoolsWithMonitoringOrders',
        error as Error,
        {},
      );
      throw error;
    }
  }

  /**
   * Finds actively monitoring orders for a specific pool address on a given chain.
   */
  async findMonitoringOrdersForPool(
    chainId: number,
    poolAddress: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: {
        position: {
          AND: [
            { config: { path: ['poolAddress'], equals: poolAddress } },
            { config: { path: ['chainId'], equals: chainId } },
          ],
        },
        automationState: 'monitoring',
      },
    });
  }

  /**
   * Finds orders in retrying state (for startup recovery).
   */
  async findRetryingOrders(
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: { automationState: 'retrying' },
    });
  }

  /**
   * Deletes an order. Used when OrderCancelled event is received,
   * or when a new registration overwrites an existing slot.
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      const db = tx ?? this.prisma;
      await db.closeOrder.delete({ where: { id } });

      this.logger.info({ id }, 'Close order deleted');
      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  // ==========================================================================
  // STATE UPDATES
  // ==========================================================================

  /**
   * Merges partial updates into the order's state JSON (read-modify-write).
   * Used for on-chain config-change events (operator, payout, validUntil, slippage).
   */
  async mergeState(
    id: string,
    stateUpdates: Record<string, unknown>,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'mergeState', {
      id,
      updateKeys: Object.keys(stateUpdates),
    });

    try {
      const db = tx ?? this.prisma;
      const existing = await db.closeOrder.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      const currentState = (existing.state as Record<string, unknown>) ?? {};
      const mergedState = { ...currentState, ...stateUpdates };

      const result = await db.closeOrder.update({
        where: { id },
        data: { state: mergedState as Prisma.InputJsonValue },
      });

      this.logger.info(
        { id, updatedFields: Object.keys(stateUpdates) },
        'Close order state merged',
      );
      log.methodExit(this.logger, 'mergeState', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'mergeState', error as Error, { id });
      throw error;
    }
  }

  /**
   * Updates the closeOrderHash column (e.g. when trigger tick changes).
   * Also merges state updates if provided.
   */
  async updateCloseOrderHash(
    id: string,
    newCloseOrderHash: string,
    stateUpdates?: Record<string, unknown>,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'updateCloseOrderHash', {
      id,
      newCloseOrderHash,
    });

    try {
      const db = tx ?? this.prisma;

      if (stateUpdates) {
        const existing = await db.closeOrder.findUnique({ where: { id } });
        if (!existing) {
          throw new Error(`Close order not found: ${id}`);
        }

        const currentState = (existing.state as Record<string, unknown>) ?? {};
        const mergedState = { ...currentState, ...stateUpdates };

        const result = await db.closeOrder.update({
          where: { id },
          data: {
            closeOrderHash: newCloseOrderHash,
            state: mergedState as Prisma.InputJsonValue,
          },
        });

        this.logger.info({ id, newCloseOrderHash }, 'Close order hash and state updated');
        log.methodExit(this.logger, 'updateCloseOrderHash', { id });
        return result;
      }

      const result = await db.closeOrder.update({
        where: { id },
        data: { closeOrderHash: newCloseOrderHash },
      });

      this.logger.info({ id, newCloseOrderHash }, 'Close order hash updated');
      log.methodExit(this.logger, 'updateCloseOrderHash', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateCloseOrderHash', error as Error, {
        id,
        newCloseOrderHash,
      });
      throw error;
    }
  }

  /**
   * Refreshes on-chain state from a getOrder() call.
   * Updates state JSON and lastSyncedAt.
   */
  async syncFromChain(
    id: string,
    chainData: SyncFromChainInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'syncFromChain', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          state: chainData.state as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });

      this.logger.info({ id }, 'Order synced from chain');
      log.methodExit(this.logger, 'syncFromChain', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'syncFromChain', error as Error, { id });
      throw error;
    }
  }

  // ==========================================================================
  // AUTOMATION STATE TRANSITIONS
  // ==========================================================================

  /**
   * Atomic conditional transition: monitoring|retrying → executing.
   *
   * Concurrency gate: uses updateMany with WHERE automationState IN ('monitoring','retrying')
   * to ensure only one consumer wins the race. Increments executionAttempts.
   * Throws if lost the race.
   */
  async atomicTransitionToExecuting(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'atomicTransitionToExecuting', { id });

    try {
      const db = tx ?? this.prisma;

      // CAS: only transition if in monitoring or retrying
      const updateResult = await db.closeOrder.updateMany({
        where: {
          id,
          automationState: { in: ['monitoring', 'retrying'] },
        },
        data: {
          automationState: 'executing',
        },
      });

      if (updateResult.count === 0) {
        const current = await db.closeOrder.findUnique({
          where: { id },
          select: { automationState: true },
        });
        throw new Error(
          `Failed to transition order ${id} to executing: ` +
            `current automationState='${current?.automationState}' (expected 'monitoring' or 'retrying'). ` +
            `Race condition detected.`,
        );
      }

      // Increment executionAttempts in follow-up update
      const result = await db.closeOrder.update({
        where: { id },
        data: { executionAttempts: { increment: 1 } },
      });

      this.logger.info(
        { id, executionAttempts: result.executionAttempts },
        'Order transitioned to executing',
      );
      log.methodExit(this.logger, 'atomicTransitionToExecuting', { id });
      return result;
    } catch (error) {
      log.methodError(
        this.logger,
        'atomicTransitionToExecuting',
        error as Error,
        { id },
      );
      throw error;
    }
  }

  /**
   * Transitions executing → retrying (execution failed, waiting for retry).
   * Sets lastError for diagnostics.
   */
  async transitionToRetrying(
    id: string,
    error: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'transitionToRetrying', { id, error });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          automationState: 'retrying',
          lastError: error,
        },
      });

      this.logger.info({ id, automationState: 'retrying' }, 'Order transitioned to retrying');
      log.methodExit(this.logger, 'transitionToRetrying', { id });
      return result;
    } catch (err) {
      log.methodError(this.logger, 'transitionToRetrying', err as Error, { id });
      throw err;
    }
  }

  /**
   * Resets retrying → monitoring (price moved away from trigger).
   * Clears executionAttempts and lastError.
   */
  async resetToMonitoring(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'resetToMonitoring', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          automationState: 'monitoring',
          executionAttempts: 0,
          lastError: null,
        },
      });

      this.logger.info({ id }, 'Order reset to monitoring (price moved away)');
      log.methodExit(this.logger, 'resetToMonitoring', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'resetToMonitoring', error as Error, { id });
      throw error;
    }
  }

  /**
   * Marks order as failed (max execution attempts exhausted, terminal).
   * User must cancel on-chain and re-register to try again.
   */
  async markFailed(
    id: string,
    error: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'markFailed', { id, error });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          automationState: 'failed',
          lastError: error,
        },
      });

      this.logger.warn({ id, automationState: 'failed' }, 'Order marked as failed');
      log.methodExit(this.logger, 'markFailed', { id });
      return result;
    } catch (err) {
      log.methodError(this.logger, 'markFailed', err as Error, { id });
      throw err;
    }
  }

  /**
   * Sets automation state for user-initiated monitoring control.
   *
   * Before validating the transition, refreshes on-chain state so the DB
   * reflects the latest operator/order status. This allows the UI to call
   * this method right after an on-chain setOperator() tx is confirmed —
   * refresh() will transition inactive→paused if the operator is now ours,
   * and then the paused→monitoring transition succeeds in the same request.
   *
   * Allowed source states after refresh: paused, monitoring, failed.
   * Rejects: inactive (operator not ours), executing, retrying.
   */
  async setAutomationState(
    id: string,
    targetState: 'monitoring' | 'paused',
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'setAutomationState', { id, targetState });

    const db = tx ?? this.prisma;
    const order = await db.closeOrder.findUniqueOrThrow({ where: { id } });

    // Refresh on-chain state before validating. This syncs operator changes
    // (inactive→paused) so the subsequent transition can succeed.
    await this.refresh(order.positionId, 'latest', tx);

    // Re-read order after refresh — its automationState may have changed
    const refreshedOrder = await db.closeOrder.findUniqueOrThrow({ where: { id } });
    const currentState = refreshedOrder.automationState;

    const ALLOWED_SOURCE_STATES = ['paused', 'monitoring', 'failed'];
    if (!ALLOWED_SOURCE_STATES.includes(currentState)) {
      throw new Error(
        `Cannot set automation state from '${currentState}' to '${targetState}'. ` +
        `Only paused, monitoring, and failed orders can be changed.`
      );
    }

    if (currentState === targetState) {
      this.logger.info({ id, currentState }, 'Automation state already matches target, no change');
      log.methodExit(this.logger, 'setAutomationState', { id });
      return refreshedOrder;
    }

    const data: Record<string, unknown> = { automationState: targetState };

    // Reset execution state when transitioning from failed
    if (currentState === 'failed') {
      data.executionAttempts = 0;
      data.lastError = null;
    }

    const result = await db.closeOrder.update({
      where: { id },
      data,
    });

    this.logger.info(
      { id, from: currentState, to: targetState },
      'Automation state updated by user',
    );
    log.methodExit(this.logger, 'setAutomationState', { id });
    return result;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Reads a single on-chain order via getOrder(nftId, triggerMode).
   * Returns the full order struct, or null if status is NONE.
   */
  private async readOnChainOrder(
    chainId: number,
    contractAddress: string,
    nftId: bigint,
    triggerMode: ContractTriggerMode,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<OnChainOrder | null> {
    const client = EvmConfig.getInstance().getPublicClient(chainId);
    const blockNumberParam = blockNumber === 'latest' ? undefined : BigInt(blockNumber);

    const result = await client.readContract({
      address: contractAddress as `0x${string}`,
      abi: POSITION_CLOSER_GET_ORDER_ABI,
      functionName: 'getOrder',
      args: [nftId, triggerMode],
      blockNumber: blockNumberParam,
    });

    if (result.status === OnChainOrderStatus.NONE) {
      return null;
    }

    return {
      status: result.status,
      nftId: result.nftId,
      owner: result.owner,
      pool: result.pool,
      triggerTick: result.triggerTick,
      payout: result.payout,
      operator: result.operator,
      validUntil: result.validUntil,
      slippageBps: result.slippageBps,
      swapDirection: result.swapDirection as ContractSwapDirection,
      swapSlippageBps: result.swapSlippageBps,
    };
  }

  /**
   * Reads a single vault on-chain order via getOrder(vault, owner, triggerMode).
   * Returns the full order struct, or null if status is NONE.
   */
  private async readVaultOnChainOrder(
    chainId: number,
    contractAddress: string,
    vaultAddress: string,
    ownerAddress: string,
    triggerMode: ContractTriggerMode,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<OnChainOrder | null> {
    const client = EvmConfig.getInstance().getPublicClient(chainId);
    const blockNumberParam = blockNumber === 'latest' ? undefined : BigInt(blockNumber);

    const result = await client.readContract({
      address: contractAddress as `0x${string}`,
      abi: VAULT_POSITION_CLOSER_GET_ORDER_ABI,
      functionName: 'getOrder',
      args: [vaultAddress as `0x${string}`, ownerAddress as `0x${string}`, triggerMode],
      blockNumber: blockNumberParam,
    });

    if (result.status === OnChainOrderStatus.NONE) {
      return null;
    }

    return {
      status: result.status,
      vault: result.vault,
      owner: result.owner,
      pool: result.pool,
      shares: result.shares,
      triggerTick: result.triggerTick,
      payout: result.payout,
      operator: result.operator,
      validUntil: result.validUntil,
      slippageBps: result.slippageBps,
      swapDirection: result.swapDirection as ContractSwapDirection,
      swapSlippageBps: result.swapSlippageBps,
    };
  }

  private buildWhereClause(
    options: FindCloseOrderOptions & { positionId?: string },
  ): Prisma.CloseOrderWhereInput {
    const where: Prisma.CloseOrderWhereInput = {};

    if (options.positionId) {
      where.positionId = options.positionId;
    }

    if (options.automationState !== undefined) {
      if (Array.isArray(options.automationState)) {
        where.automationState = { in: options.automationState };
      } else {
        where.automationState = options.automationState;
      }
    }

    return where;
  }
}
