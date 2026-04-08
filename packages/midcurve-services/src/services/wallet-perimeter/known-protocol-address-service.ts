/**
 * Known Protocol Address Service
 *
 * CRUD operations for the known protocol address registry.
 * Used to classify transfer destinations as protocol deposits vs. external transfers.
 */

import { prisma as prismaClient, Prisma, type PrismaClient } from '@midcurve/database';
import type { KnownProtocolAddress } from '@midcurve/database';
import { normalizeAddress } from '@midcurve/shared';
import type {
  CreateKnownProtocolAddressInput,
  UpdateKnownProtocolAddressInput,
} from '../types/wallet-perimeter/index.js';

export class KnownProtocolAddressService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: { prisma?: PrismaClient } = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
  }

  /**
   * Build protocolAddressHash and config from chain type, chain ID, and address.
   * EVM: normalizes address to EIP-55 checksum.
   */
  private buildAddressData(
    chainType: string,
    chainId: number,
    address: string,
  ): { protocolAddressHash: string; config: Record<string, unknown> } {
    switch (chainType) {
      case 'evm': {
        const normalized = normalizeAddress(address);
        return {
          protocolAddressHash: `evm/${chainId}/${normalized}`,
          config: { chainId, address: normalized },
        };
      }
      case 'solana':
        return {
          protocolAddressHash: `solana/${chainId}/${address}`,
          config: { chainId, address },
        };
      default:
        throw new Error(`Unsupported chain type: ${chainType}`);
    }
  }

  async create(input: CreateKnownProtocolAddressInput): Promise<KnownProtocolAddress> {
    const { protocolAddressHash, config } = this.buildAddressData(
      input.chainType,
      input.chainId,
      input.address,
    );

    return this.prisma.knownProtocolAddress.create({
      data: {
        chainType: input.chainType,
        protocolName: input.protocolName,
        interactionType: input.interactionType,
        protocolAddressHash,
        label: input.label,
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findById(id: string): Promise<KnownProtocolAddress | null> {
    return this.prisma.knownProtocolAddress.findUnique({ where: { id } });
  }

  async findByHash(protocolAddressHash: string): Promise<KnownProtocolAddress | null> {
    return this.prisma.knownProtocolAddress.findUnique({ where: { protocolAddressHash } });
  }

  /**
   * Find a known protocol address by chain type, chain ID, and address.
   * Normalizes the address before lookup.
   */
  async findByChainAndAddress(
    chainType: string,
    chainId: number,
    address: string,
  ): Promise<KnownProtocolAddress | null> {
    const { protocolAddressHash } = this.buildAddressData(chainType, chainId, address);
    return this.prisma.knownProtocolAddress.findUnique({ where: { protocolAddressHash } });
  }

  async findByProtocol(protocolName: string): Promise<KnownProtocolAddress[]> {
    return this.prisma.knownProtocolAddress.findMany({
      where: { protocolName, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAll(activeOnly = true): Promise<KnownProtocolAddress[]> {
    return this.prisma.knownProtocolAddress.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, input: UpdateKnownProtocolAddressInput): Promise<KnownProtocolAddress> {
    return this.prisma.knownProtocolAddress.update({
      where: { id },
      data: input,
    });
  }

  async delete(id: string): Promise<KnownProtocolAddress> {
    return this.prisma.knownProtocolAddress.delete({ where: { id } });
  }
}
