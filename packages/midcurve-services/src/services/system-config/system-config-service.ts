/**
 * SystemConfigService
 *
 * CRUD operations for the system config key-value table (`settings`).
 * Used by AppConfig to read system-level configuration (API keys, wallet addresses)
 * that are stored in the database via the config wizard.
 *
 * Singleton pattern with dependency injection for testing.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface SystemConfigServiceDependencies {
  prisma?: PrismaClient;
}

export class SystemConfigService {
  private static instance: SystemConfigService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: SystemConfigServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('SystemConfigService');
  }

  static getInstance(): SystemConfigService {
    if (!SystemConfigService.instance) {
      SystemConfigService.instance = new SystemConfigService();
    }
    return SystemConfigService.instance;
  }

  static resetInstance(): void {
    SystemConfigService.instance = null;
  }

  /**
   * Get a single config value by key.
   */
  async get(key: string): Promise<string | null> {
    const entry = await this.prisma.systemConfig.findUnique({ where: { key } });
    return entry?.value ?? null;
  }

  /**
   * Get multiple config values by keys. Returns a map of key → value.
   * Missing keys are omitted from the result.
   */
  async getMany(keys: string[]): Promise<Record<string, string>> {
    const entries = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys } },
    });
    const result: Record<string, string> = {};
    for (const e of entries) {
      result[e.key] = e.value;
    }
    return result;
  }

  /**
   * Get all config entries as a key → value map.
   */
  async getAll(): Promise<Record<string, string>> {
    const entries = await this.prisma.systemConfig.findMany();
    const result: Record<string, string> = {};
    for (const e of entries) {
      result[e.key] = e.value;
    }
    return result;
  }

  /**
   * Set a single config entry (upsert).
   */
  async set(key: string, value: string): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.logger.info({ key }, 'System config updated');
  }

  /**
   * Set multiple config entries in a transaction (upsert each).
   */
  async setMany(entries: Record<string, string>): Promise<void> {
    const ops = Object.entries(entries).map(([key, value]) =>
      this.prisma.systemConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    );
    await this.prisma.$transaction(ops);
    this.logger.info({ keys: Object.keys(entries) }, 'System config updated (batch)');
  }

  /**
   * Check if all specified keys exist in the system config table.
   */
  async hasAll(keys: string[]): Promise<boolean> {
    const count = await this.prisma.systemConfig.count({
      where: { key: { in: keys } },
    });
    return count === keys.length;
  }
}
