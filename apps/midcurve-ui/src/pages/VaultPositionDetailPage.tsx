import { useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useUniswapV3VaultPosition } from '../hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition';
import { PositionDetailLayout } from '../components/positions/position-detail-layout';
import { AlertCircle, Loader2 } from 'lucide-react';
import { getChainMetadata, isValidChainSlug } from '../config/chains';
import type { EvmChainSlug } from '../config/chains';

export function VaultPositionDetailPage() {
  const params = useParams();

  const chainSlug = params?.chain as string | undefined;
  const vaultAddress = params?.vaultAddress as string | undefined;
  const ownerAddress = params?.ownerAddress as string | undefined;

  const chainMetadata =
    chainSlug && isValidChainSlug(chainSlug)
      ? getChainMetadata(chainSlug as EvmChainSlug)
      : null;
  const chainId = chainMetadata?.chainId || 42161;

  const {
    data: position,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useUniswapV3VaultPosition(chainId, vaultAddress || '0x0', ownerAddress || '0x0');

  useEffect(() => {
    if (position && !position.protocol && !isFetching) {
      refetch();
    }
  }, [position, isFetching, refetch]);

  if (!chainSlug || !vaultAddress || !ownerAddress) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
              <h3 className="text-xl font-semibold text-white">Loading...</h3>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isValidChainSlug(chainSlug) || !chainMetadata) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="p-4 bg-red-500/20 rounded-full inline-block">
                <AlertCircle className="w-12 h-12 text-red-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">Invalid Chain</h3>
              <p className="text-slate-400">Chain &quot;{chainSlug}&quot; is not supported.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || (position && !position.protocol)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
              <h3 className="text-xl font-semibold text-white">Loading Vault Position</h3>
              <p className="text-slate-400">Fetching position data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="p-4 bg-red-500/20 rounded-full inline-block">
                <AlertCircle className="w-12 h-12 text-red-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">Error Loading Position</h3>
              <p className="text-slate-400 max-w-md">
                {error instanceof Error ? error.message : 'Failed to fetch vault position data'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!position) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="p-4 bg-amber-500/20 rounded-full inline-block">
                <AlertCircle className="w-12 h-12 text-amber-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">Vault Position Not Found</h3>
              <p className="text-slate-400 max-w-md">
                Could not find vault position {vaultAddress?.slice(0, 10)}... on {chainMetadata.name}.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
        <PositionDetailLayout position={position} />
      </div>
    </div>
  );
}
