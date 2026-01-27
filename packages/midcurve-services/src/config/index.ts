/**
 * Configuration exports for Midcurve Services
 */

export {
  EvmConfig,
  getEvmConfig,
  SupportedChainId,
  type ChainConfig,
} from './evm.js';

export {
  UNISWAP_V3_POSITION_MANAGER_ADDRESSES,
  UNISWAP_V3_POSITION_MANAGER_ABI,
  UNISWAP_V3_FACTORY_ADDRESSES,
  UNISWAP_V3_FACTORY_ABI,
  NFPM_DEPLOYMENT_BLOCKS,
  getPositionManagerAddress,
  getFactoryAddress,
  getNfpmDeploymentBlock,
  type UniswapV3PositionData,
} from './uniswapv3.js';

export {
  DEFAULT_QUOTE_TOKENS_BY_CHAIN,
  getDefaultQuoteTokens,
  hasDefaultQuoteTokens,
} from './quote-tokens.js';

export {
  UNISWAP_V3_SUBGRAPH_ENDPOINTS,
  getUniswapV3SubgraphEndpoint,
  isUniswapV3SubgraphSupported,
  getSupportedUniswapV3SubgraphChains,
} from './uniswapv3-subgraph.js';
