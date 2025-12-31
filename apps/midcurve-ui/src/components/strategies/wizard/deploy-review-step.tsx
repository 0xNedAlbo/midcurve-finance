import { Info } from "lucide-react";
import type { StrategyManifest, ConstructorParam } from "@midcurve/shared";
import type { ResolvedFundingToken } from "@midcurve/api-shared";
import { getChainMetadataByChainId } from "@/config/chains";

interface DeployReviewStepProps {
  manifest: StrategyManifest;
  strategyName: string;
  constructorValues: Record<string, string>;
  /** ETH amount to fund vault for gas */
  ethFundingAmount: string;
  /** Resolved funding token info from verification (with symbol from on-chain) */
  resolvedFundingToken?: ResolvedFundingToken;
}

export function DeployReviewStep({
  manifest,
  strategyName,
  constructorValues,
  ethFundingAmount,
  resolvedFundingToken,
}: DeployReviewStepProps) {
  // Get display value for a constructor parameter based on its source
  const getParamDisplayValue = (param: ConstructorParam): string => {
    switch (param.source) {
      case "operator-address":
        return "Auto-generated wallet";
      case "core-address":
        return "System address";
      case "user-input":
        return constructorValues[param.name] || "-";
      default:
        return "-";
    }
  };

  // Get funding token info from manifest and resolved token
  const fundingToken = manifest.fundingToken;
  const chainMeta = fundingToken
    ? getChainMetadataByChainId(fundingToken.chainId)
    : null;
  const chainName = chainMeta?.shortName || `Chain ${fundingToken?.chainId}`;
  const tokenSymbol = resolvedFundingToken?.symbol || "ERC20";
  const fundingTokenDisplay = fundingToken
    ? `${tokenSymbol} on ${chainName}`
    : "Not configured";

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-slate-300 text-sm">
              Review your configuration below. Click <span className="text-white font-medium">Next</span> to
              start the deployment process which includes creating your automation wallet,
              deploying the strategy, and setting up your funding vault.
            </p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Strategy Template</span>
            <span className="text-white font-medium">{manifest.name}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Version</span>
            <span className="text-white">v{manifest.version}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Strategy Name</span>
            <span className="text-white font-medium">{strategyName}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Strategy Network</span>
            <span className="text-white">SEMSEE (Internal)</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Quote Currency</span>
            <span className="text-white font-medium">
              {manifest.quoteToken.type === "basic-currency" ? (
                manifest.quoteToken.symbol
              ) : (
                <>
                  {manifest.quoteToken.symbol}{" "}
                  <span className="text-slate-400 text-xs font-normal">
                    (Chain {manifest.quoteToken.chainId})
                  </span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Vault / Funding Section */}
        <div className="p-4 bg-slate-800/30">
          <p className="text-slate-300 text-sm font-medium mb-3">Funding Vault</p>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Vault Token</span>
              <span className="text-white">{fundingTokenDisplay}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">ETH Gas Funding</span>
              <span className="text-white font-medium">{ethFundingAmount} ETH</span>
            </div>
            <p className="text-slate-500 text-xs mt-2">
              The vault will be deployed on the funding token's chain. You'll sign
              transactions to deploy and fund it with ETH for gas costs.
            </p>
          </div>
        </div>

        {/* Constructor Parameters (all params including auto-populated) */}
        {manifest.constructorParams.length > 0 && (
          <div className="p-4">
            <p className="text-slate-400 text-sm mb-3">Constructor Parameters</p>
            <div className="space-y-2">
              {manifest.constructorParams.map((param) => (
                <div
                  key={param.name}
                  className="flex justify-between items-center text-sm"
                >
                  <span className="text-slate-400">
                    {param.ui?.label ?? param.name}
                  </span>
                  <span className="text-white font-mono">
                    {getParamDisplayValue(param)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* What Happens Next */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
        <p className="text-slate-300 text-sm font-medium mb-3">What Happens Next</p>
        <ol className="text-slate-400 text-sm space-y-2 list-decimal list-inside">
          <li>Create automation wallet (automatic)</li>
          <li>Deploy strategy contract (automatic)</li>
          <li>Deploy funding vault (you sign)</li>
          <li>Fund vault with ETH (you sign)</li>
        </ol>
      </div>
    </div>
  );
}
