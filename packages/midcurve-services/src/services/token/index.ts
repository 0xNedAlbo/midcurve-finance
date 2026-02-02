/**
 * Token service exports
 */

export { TokenService } from './token-service.js';
export type { TokenServiceDependencies } from './token-service.js';

export { Erc20TokenService } from './erc20-token-service.js';
export type { Erc20TokenServiceDependencies } from './erc20-token-service.js';

export { BasicCurrencyTokenService } from './basic-currency-token-service.js';
export type { BasicCurrencyTokenServiceDependencies } from './basic-currency-token-service.js';

export { UserTokenBalanceService } from './user-token-balance-service.js';
export type {
  UserTokenBalanceServiceDependencies,
  TokenBalance,
} from './user-token-balance-service.js';

export { Erc20ApprovalService } from './erc20-approval-service.js';
export type {
  Erc20ApprovalServiceDependencies,
  Erc20Approval,
} from './erc20-approval-service.js';

export { Erc721ApprovalService } from './erc721-approval-service.js';
export type {
  Erc721ApprovalServiceDependencies,
  Erc721Approval,
  Erc721ApprovalOptions,
} from './erc721-approval-service.js';

// Export search types from token-input.ts
export type {
  Erc20TokenSearchInput,
  Erc20TokenSearchCandidate,
  BasicCurrencySearchInput,
  BasicCurrencySearchCandidate,
} from '../types/token/token-input.js';
