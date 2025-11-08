/**
 * Auth.js Configuration Exports
 *
 * This file exports the auth helpers (auth, signIn, signOut) for use
 * in middleware and other parts of the application.
 *
 * The actual NextAuth configuration is in app/api/auth/[...nextauth]/route.ts
 * but Next.js doesn't allow exporting non-handler functions from route files.
 */

import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { SiweMessage } from 'siwe';
import { PrismaClient } from '@prisma/client';
import { AuthUserService, AuthNonceService } from '@midcurve/services';
import { normalizeAddress } from '@midcurve/shared';

const prisma = new PrismaClient();
const authUserService = new AuthUserService();
const authNonceService = new AuthNonceService();

export const { auth, signIn, signOut, handlers } = NextAuth({
  adapter: PrismaAdapter(prisma),

  providers: [
    CredentialsProvider({
      id: 'siwe',
      name: 'Sign-In with Ethereum',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },

      async authorize(credentials) {
        try {
          if (!credentials?.message || !credentials?.signature) {
            console.error('SIWE: Missing credentials');
            return null;
          }

          // 1. Parse SIWE message
          const siweMessage = new SiweMessage(JSON.parse(credentials.message as string));

          // 2. Verify signature
          const result = await siweMessage.verify({
            signature: credentials.signature as string,
          });

          if (!result.success) {
            console.error('SIWE: Signature verification failed');
            return null;
          }

          // 3. Validate nonce (prevent replay attacks)
          const nonceValid = await authNonceService.validateNonce(siweMessage.nonce);
          if (!nonceValid) {
            console.error('SIWE: Invalid or expired nonce');
            return null;
          }

          // 4. Consume nonce (single use)
          await authNonceService.consumeNonce(siweMessage.nonce);

          // 5. Normalize wallet address
          const address = normalizeAddress(siweMessage.address);
          const chainId = siweMessage.chainId;

          // 6. Check if wallet already exists
          const existingUser = await authUserService.findUserByWallet(address, chainId);

          if (existingUser) {
            // Existing user - return for session creation
            return {
              id: existingUser.id,
              name: existingUser.name,
              email: existingUser.email,
              image: existingUser.image,
            };
          }

          // 7. New user - create with initial wallet
          const newUser = await authUserService.createUser({
            name: `User ${address.slice(0, 6)}...${address.slice(-4)}`,
            walletAddress: address,
            walletChainId: chainId,
          });

          return {
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            image: newUser.image,
          };
        } catch (error) {
          console.error('SIWE authorization error:', error);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  callbacks: {
    async jwt({ token, user }) {
      // Initial sign in
      if (user) {
        token.userId = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId && session.user) {
        // Inject user ID into session
        session.user.id = token.userId as string;

        // Fetch and inject wallet addresses
        const wallets = await authUserService.getUserWallets(token.userId as string);
        session.user.wallets = wallets;
      }

      return session;
    },
  },

  pages: {
    signIn: '/', // Home page with wallet connect
    error: '/auth/error', // Error page (future)
  },

  debug: process.env.NODE_ENV === 'development',
});
