/**
 * Cache Service Module
 *
 * Provides distributed caching using PostgreSQL as the backend.
 * Enables cache sharing across multiple processes, workers, and serverless functions.
 */

export { CacheService } from './cache-service.js';
export type { CacheServiceDependencies } from './cache-service.js';
