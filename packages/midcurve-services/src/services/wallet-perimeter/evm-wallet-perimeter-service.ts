/**
 * EVM Wallet Perimeter Service
 *
 * Classifies EVM transfer events by checking source/destination addresses
 * against the user's wallets and the known protocol address registry.
 *
 * Consumed by ledger services when processing TRANSFER events to determine
 * whether a transfer has financial impact (position leaving perimeter)
 * or is a lifecycle marker (internal transfer, protocol deposit).
 */

import { prisma as prismaClient, type PrismaClient } from '@midcurve/database';
import { normalizeAddress, type TransferClassification } from '@midcurve/shared';

export interface EvmClassifyTransferParams {
  userId: string;
  fromAddress: string;
  toAddress: string;
  chainId: number;
}

export class EvmWalletPerimeterService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: { prisma?: PrismaClient } = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
  }

  /**
   * Classify a transfer for a given user on an EVM chain.
   *
   * Decision tree:
   * 1. Both from+to are user wallets → internal_transfer
   * 2. From user → known protocol → deposit_to_protocol
   * 3. From known protocol → user → withdrawal_from_protocol
   * 4. From user → unknown → transfer_out
   * 5. From unknown → user → transfer_in
   * 6. Neither recognized → unknown (conservative: withinPerimeter = true)
   */
  async classifyTransfer(params: EvmClassifyTransferParams): Promise<TransferClassification> {
    const normalizedFrom = normalizeAddress(params.fromAddress);
    const normalizedTo = normalizeAddress(params.toAddress);

    const fromWalletHash = `evm/${normalizedFrom}`;
    const toWalletHash = `evm/${normalizedTo}`;
    const fromProtocolHash = `evm/${params.chainId}/${normalizedFrom}`;
    const toProtocolHash = `evm/${params.chainId}/${normalizedTo}`;

    const [fromWallet, toWallet, fromProtocol, toProtocol] = await Promise.all([
      this.prisma.userWallet.findFirst({
        where: { userId: params.userId, walletHash: fromWalletHash },
        select: { id: true },
      }),
      this.prisma.userWallet.findFirst({
        where: { userId: params.userId, walletHash: toWalletHash },
        select: { id: true },
      }),
      this.prisma.knownProtocolAddress.findUnique({
        where: { protocolAddressHash: fromProtocolHash, isActive: true },
        select: { protocolName: true, interactionType: true },
      }),
      this.prisma.knownProtocolAddress.findUnique({
        where: { protocolAddressHash: toProtocolHash, isActive: true },
        select: { protocolName: true, interactionType: true },
      }),
    ]);

    const fromIsUser = fromWallet !== null;
    const toIsUser = toWallet !== null;

    // 1. Both addresses belong to user → internal transfer
    if (fromIsUser && toIsUser) {
      return { classification: 'internal_transfer', withinPerimeter: true, counterparty: null };
    }

    // 2. From user → known protocol → deposit
    if (fromIsUser && toProtocol) {
      return {
        classification: 'deposit_to_protocol',
        withinPerimeter: true,
        counterparty: {
          protocolName: toProtocol.protocolName,
          interactionType: toProtocol.interactionType,
        },
      };
    }

    // 3. From known protocol → user → withdrawal
    if (toIsUser && fromProtocol) {
      return {
        classification: 'withdrawal_from_protocol',
        withinPerimeter: true,
        counterparty: {
          protocolName: fromProtocol.protocolName,
          interactionType: fromProtocol.interactionType,
        },
      };
    }

    // 4. From user → unknown address → left perimeter
    if (fromIsUser && !toIsUser) {
      return { classification: 'transfer_out', withinPerimeter: false, counterparty: null };
    }

    // 5. From unknown → user → entered perimeter
    if (!fromIsUser && toIsUser) {
      return { classification: 'transfer_in', withinPerimeter: true, counterparty: null };
    }

    // 6. Neither recognized → unknown (conservative default)
    return { classification: 'unknown', withinPerimeter: true, counterparty: null };
  }

  /**
   * Check if an EVM address belongs to the given user.
   */
  async isUserAddress(userId: string, address: string): Promise<boolean> {
    const normalized = normalizeAddress(address);
    const walletHash = `evm/${normalized}`;
    const wallet = await this.prisma.userWallet.findFirst({
      where: { userId, walletHash },
      select: { id: true },
    });
    return wallet !== null;
  }
}
