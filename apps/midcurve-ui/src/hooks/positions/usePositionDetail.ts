import { useUniswapV3Position } from './uniswapv3/useUniswapV3Position';
import type { ListPositionData } from '@midcurve/api-shared';

interface UsePositionDetailParams {
  protocol: string;
  chainId?: number;
  nftId?: string;
  positionId?: string; // For future Solana support (base58 string)
  initialData?: ListPositionData;
  enabled?: boolean;
}

/**
 * Protocol-agnostic position detail hook
 *
 * Fetches fresh position data from the detail endpoint for the given protocol.
 * Uses initialData (from list query) as a placeholder while loading to prevent
 * loading skeleton flickers.
 *
 * This hook serves as a dispatcher that routes to protocol-specific detail hooks.
 *
 * @param params - Position identifiers and options
 * @returns Query result with position data from detail endpoint
 *
 * @example
 * ```tsx
 * const { data: position } = usePositionDetail({
 *   protocol: 'uniswapv3',
 *   chainId: 1,
 *   nftId: '12345',
 *   initialData: listPositionData, // Shows immediately while loading
 * });
 * ```
 */
export function usePositionDetail(params: UsePositionDetailParams) {
  const { protocol, chainId, nftId, initialData, enabled = true } = params;

  // Dispatch to protocol-specific hook
  switch (protocol) {
    case 'uniswapv3': {
      if (!chainId || !nftId) {
        throw new Error('chainId and nftId are required for uniswapv3 positions');
      }
      return useUniswapV3Position(chainId, nftId, {
        initialData: initialData as any, // Type cast needed due to generic constraints
        enabled,
      });
    }

    // Future protocol support:
    // case 'orca': {
    //   if (!positionId) {
    //     throw new Error('positionId is required for Orca positions');
    //   }
    //   return useOrcaPosition(positionId, { initialData, enabled });
    // }

    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
}
