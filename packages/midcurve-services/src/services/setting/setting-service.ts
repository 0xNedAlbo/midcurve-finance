/**
 * SettingService
 *
 * CRUD operations for the `settings` key-value table.
 * Used by AppConfig to read user-provided configuration (API keys, wallet addresses)
 * that are stored in the database via the config wizard.
 *
 * Singleton pattern with dependency injection for testing.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface SettingServiceDependencies {
  prisma?: PrismaClient;
}

export class SettingService {
  private static instance: SettingService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: SettingServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('SettingService');
  }

  static getInstance(): SettingService {
    if (!SettingService.instance) {
      SettingService.instance = new SettingService();
    }
    return SettingService.instance;
  }

  static resetInstance(): void {
    SettingService.instance = null;
  }

  /**
   * Get a single setting value by key.
   */
  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  /**
   * Get multiple settings by keys. Returns a map of key → value.
   * Missing keys are omitted from the result.
   */
  async getMany(keys: string[]): Promise<Record<string, string>> {
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: keys } },
    });
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  /**
   * Get all settings as a key → value map.
   */
  async getAll(): Promise<Record<string, string>> {
    const settings = await this.prisma.setting.findMany();
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  /**
   * Set a single setting (upsert).
   */
  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.logger.info({ key }, 'Setting updated');
  }

  /**
   * Set multiple settings in a transaction (upsert each).
   */
  async setMany(entries: Record<string, string>): Promise<void> {
    const ops = Object.entries(entries).map(([key, value]) =>
      this.prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    );
    await this.prisma.$transaction(ops);
    this.logger.info({ keys: Object.keys(entries) }, 'Settings updated (batch)');
  }

  /**
   * Check if all specified keys exist in the settings table.
   */
  async hasAll(keys: string[]): Promise<boolean> {
    const count = await this.prisma.setting.count({
      where: { key: { in: keys } },
    });
    return count === keys.length;
  }
}
