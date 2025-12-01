/**
 * Signer Client
 *
 * HTTP client for the midcurve-signer service.
 */

export { SignerClient } from './signer-client.js';

// Config types
export type { SignerClientConfig } from './signer-client.js';

// Wallet types
export type {
  KeyProvider,
  AutomationWallet,
  CreateWalletRequest,
} from './signer-client.js';

// Intent verification types
export type {
  VerifyIntentRequest,
  VerifyIntentResult,
} from './signer-client.js';

// Signing types
export type {
  SignErc20ApproveRequest,
  SignedTransaction,
} from './signer-client.js';

// Error classes
export {
  SignerClientError,
  SignerAuthenticationError,
  SignerNotFoundError,
  SignerValidationError,
  SignerVerificationError,
  SignerComplianceError,
  SignerSigningError,
} from './signer-client.js';
