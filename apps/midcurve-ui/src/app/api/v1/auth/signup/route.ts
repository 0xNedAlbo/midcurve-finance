import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SignupRequestSchema, type SignupResponse } from '@midcurve/api-shared';
import { getAddress } from 'viem';

/**
 * POST /api/v1/auth/signup
 *
 * Register a new user with their wallet address.
 * Creates a User record and links the wallet address as primary.
 */
export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validationResult = SignupRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { address, chainId, name } = validationResult.data;

    // Normalize address to EIP-55 checksum format
    const normalizedAddress = getAddress(address);

    // Check if wallet address already exists
    const existingWallet = await prisma.authWalletAddress.findUnique({
      where: {
        address_chainId: {
          address: normalizedAddress,
          chainId,
        },
      },
      include: {
        user: true,
      },
    });

    if (existingWallet) {
      return NextResponse.json(
        {
          error: 'WALLET_ALREADY_REGISTERED',
          message: 'This wallet address is already registered',
        },
        { status: 409 }
      );
    }

    // Create user and wallet address in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          name: name || `${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`,
        },
      });

      // Create wallet address linked to user
      const walletAddress = await tx.authWalletAddress.create({
        data: {
          userId: user.id,
          address: normalizedAddress,
          chainId,
          isPrimary: true, // First wallet is always primary
        },
      });

      return { user, walletAddress };
    });

    // Format response
    const response: SignupResponse = {
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        image: result.user.image,
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      walletAddress: {
        id: result.walletAddress.id,
        address: result.walletAddress.address,
        chainId: result.walletAddress.chainId,
        isPrimary: result.walletAddress.isPrimary,
        createdAt: result.walletAddress.createdAt.toISOString(),
        updatedAt: result.walletAddress.updatedAt.toISOString(),
      },
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to create user account',
      },
      { status: 500 }
    );
  }
}
