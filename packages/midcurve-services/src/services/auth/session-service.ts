/**
 * SessionService
 *
 * Manages server-side sessions for custom authentication.
 * Session ID stored in httpOnly cookie, session data stored in PostgreSQL.
 *
 * SECURITY:
 * - Sessions expire after 30 days by default
 * - Session IDs are 64 random characters (high entropy)
 * - Tracks user agent and IP for security auditing
 * - Supports session invalidation (logout, security events)
 */

import type { PrismaClient, Session } from '@midcurve/database';
import { prisma } from '@midcurve/database';

export interface SessionServiceDependencies {
  prisma?: PrismaClient;
}

export interface SessionData {
  id: string;
  sessionId: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
}

export interface CreateSessionContext {
  userAgent?: string;
  ipAddress?: string;
}

const SESSION_DURATION_DAYS = 30;
const SESSION_ID_LENGTH = 64;

export class SessionService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: SessionServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prisma;
  }

  /**
   * Create new session for user after SIWE verification
   *
   * @param userId - User ID to create session for
   * @param context - Optional security context (user agent, IP)
   * @returns Session ID and expiry date
   *
   * @example
   * ```typescript
   * const { sessionId, expiresAt } = await service.createSession(user.id, {
   *   userAgent: request.headers.get('user-agent'),
   *   ipAddress: request.headers.get('x-forwarded-for'),
   * });
   * ```
   */
  async createSession(
    userId: string,
    context?: CreateSessionContext
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    const { customAlphabet } = await import('nanoid');
    const generateSessionId = customAlphabet(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      SESSION_ID_LENGTH
    );

    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        sessionId,
        userId,
        expiresAt,
        userAgent: context?.userAgent,
        ipAddress: context?.ipAddress,
      },
    });

    return { sessionId, expiresAt };
  }

  /**
   * Validate session and return session data
   *
   * Updates lastUsedAt for activity tracking.
   * Returns null if session doesn't exist or is expired.
   *
   * @param sessionId - Session ID from cookie
   * @returns Session data or null if invalid/expired
   *
   * @example
   * ```typescript
   * const session = await service.validateSession(sessionId);
   * if (!session) {
   *   return unauthorized();
   * }
   * ```
   */
  async validateSession(sessionId: string): Promise<SessionData | null> {
    const session = await this.prisma.session.findUnique({
      where: { sessionId },
    });

    if (!session) {
      return null;
    }

    // Check expiry
    if (session.expiresAt < new Date()) {
      // Session expired - clean up and return null
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {
        // Ignore deletion errors (session may already be deleted)
      });
      return null;
    }

    // Update lastUsedAt (fire-and-forget for performance)
    this.prisma.session
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Ignore update errors
      });

    return {
      id: session.id,
      sessionId: session.sessionId,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
    };
  }

  /**
   * Invalidate session (logout)
   *
   * @param sessionId - Session ID to invalidate
   *
   * @example
   * ```typescript
   * await service.invalidateSession(sessionId);
   * // Clear cookie on client
   * ```
   */
  async invalidateSession(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { sessionId },
    });
  }

  /**
   * Invalidate all sessions for user (logout everywhere)
   *
   * Use for security events like password reset, suspicious activity, etc.
   *
   * @param userId - User ID to invalidate all sessions for
   * @returns Number of sessions invalidated
   *
   * @example
   * ```typescript
   * const count = await service.invalidateAllUserSessions(userId);
   * console.log(`Invalidated ${count} sessions`);
   * ```
   */
  async invalidateAllUserSessions(userId: string): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /**
   * Get all active sessions for user
   *
   * Useful for session management UI (show active sessions, allow logout)
   *
   * @param userId - User ID
   * @returns Array of active sessions
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * Cleanup expired sessions
   *
   * Run periodically to clean up expired sessions.
   *
   * @returns Number of sessions deleted
   *
   * @example
   * ```typescript
   * // Run daily via cron
   * const count = await service.cleanupExpiredSessions();
   * console.log(`Cleaned up ${count} expired sessions`);
   * ```
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }
}
