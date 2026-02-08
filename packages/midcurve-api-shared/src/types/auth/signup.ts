import { z } from 'zod';

/**
 * POST /api/v1/auth/signup
 *
 * Register a new user with their wallet address.
 * This endpoint creates a User record and links the wallet address.
 */

// Request schema
export const SignupRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  name: z.string().optional(),
});

export type SignupRequest = z.infer<typeof SignupRequestSchema>;

// Response types
export interface SignupResponse {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    createdAt: string; // ISO 8601 date string
    updatedAt: string; // ISO 8601 date string
  };
  walletAddress: {
    id: string;
    address: string; // EIP-55 checksummed
    isPrimary: boolean;
    createdAt: string;
    updatedAt: string;
  };
}
