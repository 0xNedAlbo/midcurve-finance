/**
 * Manifest Verification Service
 *
 * Validates user-uploaded strategy manifest files before deployment.
 * Performs schema validation, ABI parsing, and constructor parameter matching.
 */

import { parseAbi, getAddress } from 'viem';
import type {
  StrategyManifest,
  ConstructorParam,
  SolidityType,
  ManifestQuoteToken,
  ManifestFundingToken,
} from '@midcurve/shared';
import type { Erc20TokenService } from '../token/erc20-token-service.js';

/**
 * ABI constructor type from viem's Abi type
 */
interface AbiConstructorItem {
  type: 'constructor';
  inputs: readonly {
    name: string;
    type: string;
    internalType?: string;
    indexed?: boolean;
    components?: readonly unknown[];
  }[];
  stateMutability?: 'nonpayable' | 'payable';
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Severity level for verification issues
 */
export type VerificationSeverity = 'error' | 'warning';

/**
 * Error codes for manifest verification
 */
export type ManifestErrorCode =
  | 'INVALID_JSON'
  | 'SCHEMA_ERROR'
  | 'INVALID_ABI'
  | 'NO_CONSTRUCTOR'
  | 'PARAM_COUNT_MISMATCH'
  | 'PARAM_TYPE_MISMATCH'
  | 'PARAM_ORDER_MISMATCH'
  | 'MISSING_UI_CONFIG'
  | 'INVALID_BYTECODE'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_FIELD_VALUE'
  | 'INVALID_QUOTE_TOKEN'
  | 'QUOTE_TOKEN_SYMBOL_MISMATCH'
  | 'INVALID_FUNDING_TOKEN'
  | 'FUNDING_TOKEN_NOT_FOUND';

/**
 * A verification issue (error or warning)
 */
export interface ManifestIssue {
  /**
   * Severity level
   */
  severity: VerificationSeverity;

  /**
   * Error/warning code
   */
  code: ManifestErrorCode;

  /**
   * Human-readable message
   */
  message: string;

  /**
   * JSON path to the issue location
   */
  path?: string;

  /**
   * Additional details
   */
  details?: Record<string, unknown>;
}

/**
 * Resolved funding token metadata from on-chain discovery
 */
export interface ResolvedFundingToken {
  /**
   * Token symbol (e.g., "USDC")
   */
  symbol: string;

  /**
   * Token name (e.g., "USD Coin")
   */
  name: string;

  /**
   * Token decimals (e.g., 6 for USDC)
   */
  decimals: number;

  /**
   * Chain ID where the token exists
   */
  chainId: number;

  /**
   * Token contract address (EIP-55 checksummed)
   */
  address: string;
}

/**
 * Result of manifest verification
 */
export interface ManifestVerificationResult {
  /**
   * Whether the manifest is valid for deployment
   */
  valid: boolean;

  /**
   * List of errors that prevent deployment
   */
  errors: ManifestIssue[];

  /**
   * List of warnings (non-blocking)
   */
  warnings: ManifestIssue[];

  /**
   * Parsed manifest (if valid)
   */
  parsedManifest?: StrategyManifest;

  /**
   * Database ID of the resolved quote token
   *
   * Only set when verification includes async token resolution
   * (via verifyWithTokenResolution method)
   */
  resolvedQuoteTokenId?: string;

  /**
   * Database ID of the resolved funding token
   *
   * Only set when verification includes async token resolution
   * (via verifyWithTokenResolution method)
   */
  resolvedFundingTokenId?: string;

  /**
   * Resolved funding token metadata from on-chain discovery
   *
   * Contains the token symbol, name, decimals, chain ID, and address
   * discovered from the blockchain. Used by the UI to display user-friendly
   * information like "USDC on Arbitrum" instead of raw chain IDs.
   */
  resolvedFundingToken?: ResolvedFundingToken;
}

// =============================================================================
// SERVICE CLASS
// =============================================================================

/**
 * Manifest Verification Service
 *
 * Validates strategy manifest files for correctness and ABI consistency.
 */
export class ManifestVerificationService {
  /**
   * Validates a manifest JSON object
   */
  verify(manifest: unknown): ManifestVerificationResult {
    const errors: ManifestIssue[] = [];
    const warnings: ManifestIssue[] = [];

    // Step 1: Basic structure validation
    if (!manifest || typeof manifest !== 'object') {
      return {
        valid: false,
        errors: [
          {
            severity: 'error',
            code: 'SCHEMA_ERROR',
            message: 'Manifest must be an object',
          },
        ],
        warnings: [],
      };
    }

    const obj = manifest as Record<string, unknown>;

    // Step 2: Required field validation
    this.validateRequiredFields(obj, errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 3: Field type validation
    this.validateFieldTypes(obj, errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 4: ABI parsing and validation
    const abiResult = this.validateAbi(obj.abi as unknown[], errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 5: Constructor parameter validation
    this.validateConstructorParams(
      obj.constructorParams as ConstructorParam[],
      abiResult?.constructorAbi,
      errors,
      warnings
    );
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 6: Bytecode validation
    this.validateBytecode(obj.bytecode as string, errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 7: UI configuration validation for user-input params
    this.validateUIConfigs(obj.constructorParams as ConstructorParam[], errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 8: Quote token validation
    const quoteToken = this.validateQuoteToken(obj.quoteToken, errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Step 9: Funding token validation
    const fundingToken = this.validateFundingToken(obj.fundingToken, errors);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Build the parsed manifest
    const parsedManifest: StrategyManifest = {
      name: obj.name as string,
      version: obj.version as string,
      description: obj.description as string | undefined,
      author: obj.author as string | undefined,
      abi: obj.abi as unknown[],
      bytecode: obj.bytecode as `0x${string}`,
      constructorParams: obj.constructorParams as ConstructorParam[],
      formLayout: obj.formLayout as StrategyManifest['formLayout'],
      quoteToken: quoteToken!,
      fundingToken: fundingToken!,
      tags: obj.tags as string[] | undefined,
      logTopics: obj.logTopics as Record<string, string> | undefined,
    };

    return {
      valid: true,
      errors: [],
      warnings,
      parsedManifest,
    };
  }

  /**
   * Parses and validates manifest from JSON string
   */
  parseAndVerify(json: string): ManifestVerificationResult {
    let parsed: unknown;

    try {
      parsed = JSON.parse(json);
    } catch {
      return {
        valid: false,
        errors: [
          {
            severity: 'error',
            code: 'INVALID_JSON',
            message: 'Invalid JSON format',
          },
        ],
        warnings: [],
      };
    }

    return this.verify(parsed);
  }

  /**
   * Validates a manifest with async token resolution
   *
   * Performs synchronous validation first, then discovers the funding token
   * on-chain to validate it exists and fetch its metadata (symbol, name, decimals).
   *
   * This method should be used when the verification result will be returned
   * to the frontend, as it provides the resolved token info needed for
   * user-friendly display (e.g., "USDC on Arbitrum" instead of raw chain IDs).
   *
   * @param manifest - The manifest JSON to verify
   * @param erc20Service - Service for on-chain token discovery
   * @returns Verification result with resolved funding token info
   */
  async verifyWithTokenResolution(
    manifest: unknown,
    erc20Service: Erc20TokenService
  ): Promise<ManifestVerificationResult> {
    // Step 1: Run synchronous validation
    const result = this.verify(manifest);
    if (!result.valid || !result.parsedManifest) {
      return result;
    }

    // Step 2: Discover funding token on-chain
    const fundingToken = result.parsedManifest.fundingToken;
    try {
      const discoveredToken = await erc20Service.discover({
        address: fundingToken.address,
        chainId: fundingToken.chainId,
      });

      // Store resolved token info in result
      result.resolvedFundingTokenId = discoveredToken.id;
      result.resolvedFundingToken = {
        symbol: discoveredToken.symbol,
        name: discoveredToken.name,
        decimals: discoveredToken.decimals,
        chainId: fundingToken.chainId,
        address: getAddress(fundingToken.address), // Normalize to EIP-55
      };
    } catch (error) {
      result.valid = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        severity: 'error',
        code: 'FUNDING_TOKEN_NOT_FOUND',
        message: `Failed to discover funding token at ${fundingToken.address} on chain ${fundingToken.chainId}: ${errorMessage}`,
        path: 'fundingToken',
      });
    }

    return result;
  }

  // ===========================================================================
  // PRIVATE VALIDATION METHODS
  // ===========================================================================

  private validateRequiredFields(
    obj: Record<string, unknown>,
    errors: ManifestIssue[]
  ): void {
    const requiredFields = [
      'name',
      'version',
      'abi',
      'bytecode',
      'constructorParams',
      'quoteToken',
      'fundingToken',
    ];

    for (const field of requiredFields) {
      if (obj[field] === undefined || obj[field] === null) {
        errors.push({
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          message: `Missing required field: ${field}`,
          path: field,
        });
      }
    }
  }

  private validateFieldTypes(
    obj: Record<string, unknown>,
    errors: ManifestIssue[]
  ): void {
    // String fields
    if (typeof obj.name !== 'string' || obj.name.trim() === '') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "name" must be a non-empty string',
        path: 'name',
      });
    }

    if (typeof obj.version !== 'string' || obj.version.trim() === '') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "version" must be a non-empty string',
        path: 'version',
      });
    }

    // Optional string fields
    if (obj.description !== undefined && typeof obj.description !== 'string') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "description" must be a string',
        path: 'description',
      });
    }

    if (obj.author !== undefined && typeof obj.author !== 'string') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "author" must be a string',
        path: 'author',
      });
    }

    // Array fields
    if (!Array.isArray(obj.abi)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "abi" must be an array',
        path: 'abi',
      });
    }

    if (!Array.isArray(obj.constructorParams)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "constructorParams" must be an array',
        path: 'constructorParams',
      });
    }

    // Bytecode
    if (typeof obj.bytecode !== 'string') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "bytecode" must be a string',
        path: 'bytecode',
      });
    }

    // Optional tags
    if (obj.tags !== undefined && !Array.isArray(obj.tags)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        message: 'Field "tags" must be an array',
        path: 'tags',
      });
    }

    // Optional logTopics
    if (obj.logTopics !== undefined) {
      if (typeof obj.logTopics !== 'object' || obj.logTopics === null || Array.isArray(obj.logTopics)) {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: 'Field "logTopics" must be an object mapping topic names to descriptions',
          path: 'logTopics',
        });
      } else {
        // Validate each topic entry
        const topics = obj.logTopics as Record<string, unknown>;
        for (const [topicName, description] of Object.entries(topics)) {
          // Topic names must be uppercase identifiers
          if (!/^[A-Z][A-Z0-9_]*$/.test(topicName)) {
            errors.push({
              severity: 'error',
              code: 'INVALID_FIELD_VALUE',
              message: `Log topic name "${topicName}" must be an uppercase identifier (e.g., "POSITION_OPENED")`,
              path: `logTopics.${topicName}`,
            });
          }
          // Descriptions must be strings
          if (typeof description !== 'string') {
            errors.push({
              severity: 'error',
              code: 'INVALID_FIELD_VALUE',
              message: `Log topic "${topicName}" description must be a string`,
              path: `logTopics.${topicName}`,
            });
          }
        }
      }
    }
  }

  private validateAbi(
    abi: unknown[],
    errors: ManifestIssue[]
  ): { constructorAbi: AbiConstructorItem | null } | null {
    try {
      // Try to parse the ABI with viem (may fail for JSON-format ABIs)
      parseAbi(abi as readonly string[]);
    } catch {
      // If parseAbi fails, try a manual validation approach
      // since parseAbi expects human-readable ABI strings
    }

    // Find constructor in ABI
    const constructorItem = abi.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).type === 'constructor'
    );

    if (!constructorItem) {
      errors.push({
        severity: 'error',
        code: 'NO_CONSTRUCTOR',
        message: 'ABI must contain a constructor definition',
        path: 'abi',
      });
      return null;
    }

    // Validate constructor structure
    const constructor = constructorItem as Record<string, unknown>;
    if (!constructor.inputs || !Array.isArray(constructor.inputs)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_ABI',
        message: 'Constructor must have an inputs array',
        path: 'abi.constructor.inputs',
      });
      return null;
    }

    return {
      constructorAbi: constructorItem as AbiConstructorItem,
    };
  }

  private validateConstructorParams(
    params: ConstructorParam[],
    constructorAbi: AbiConstructorItem | null | undefined,
    errors: ManifestIssue[],
    warnings: ManifestIssue[]
  ): void {
    if (!constructorAbi) {
      return; // Already reported error
    }

    const abiInputs = constructorAbi.inputs || [];

    // Check parameter count
    if (params.length !== abiInputs.length) {
      errors.push({
        severity: 'error',
        code: 'PARAM_COUNT_MISMATCH',
        message: `Constructor has ${abiInputs.length} parameters, but ${params.length} were defined in constructorParams`,
        path: 'constructorParams',
        details: {
          expected: abiInputs.length,
          actual: params.length,
        },
      });
      return;
    }

    // Validate each parameter
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const abiInput = abiInputs[i];

      // Safety check (should never happen due to length check above)
      if (!param || !abiInput) continue;

      // Validate required fields
      if (!param.name || typeof param.name !== 'string') {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter at index ${i} must have a "name" field`,
          path: `constructorParams[${i}].name`,
        });
        continue;
      }

      if (!param.type || typeof param.type !== 'string') {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" must have a "type" field`,
          path: `constructorParams[${i}].type`,
        });
        continue;
      }

      if (!param.source || typeof param.source !== 'string') {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" must have a "source" field`,
          path: `constructorParams[${i}].source`,
        });
        continue;
      }

      // Validate source value
      const validSources = ['operator-address', 'core-address', 'user-input'];
      if (!validSources.includes(param.source)) {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" has invalid source "${param.source}". Must be one of: ${validSources.join(', ')}`,
          path: `constructorParams[${i}].source`,
        });
        continue;
      }

      // Validate type is a supported Solidity type
      const validTypes: SolidityType[] = [
        'address',
        'uint256',
        'uint128',
        'uint64',
        'uint32',
        'uint16',
        'uint8',
        'int256',
        'bool',
        'bytes32',
        'string',
      ];
      if (!validTypes.includes(param.type as SolidityType)) {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" has unsupported type "${param.type}"`,
          path: `constructorParams[${i}].type`,
        });
        continue;
      }

      // Check type matches ABI
      if (param.type !== abiInput.type) {
        errors.push({
          severity: 'error',
          code: 'PARAM_TYPE_MISMATCH',
          message: `Parameter "${param.name}" type "${param.type}" does not match ABI type "${abiInput.type}"`,
          path: `constructorParams[${i}].type`,
          details: {
            expected: abiInput.type,
            actual: param.type,
          },
        });
      }

      // Check name matches (warning only - names in ABI might differ)
      if (param.name !== abiInput.name) {
        warnings.push({
          severity: 'warning',
          code: 'PARAM_ORDER_MISMATCH',
          message: `Parameter name "${param.name}" differs from ABI name "${abiInput.name}" at index ${i}`,
          path: `constructorParams[${i}].name`,
          details: {
            expected: abiInput.name,
            actual: param.name,
          },
        });
      }
    }
  }

  private validateBytecode(bytecode: string, errors: ManifestIssue[]): void {
    // Must start with 0x
    if (!bytecode.startsWith('0x')) {
      errors.push({
        severity: 'error',
        code: 'INVALID_BYTECODE',
        message: 'Bytecode must start with "0x"',
        path: 'bytecode',
      });
      return;
    }

    // Must be valid hex
    const hexPart = bytecode.slice(2);
    if (!/^[0-9a-fA-F]*$/.test(hexPart)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_BYTECODE',
        message: 'Bytecode contains invalid hex characters',
        path: 'bytecode',
      });
      return;
    }

    // Must have even length (each byte = 2 hex chars)
    if (hexPart.length % 2 !== 0) {
      errors.push({
        severity: 'error',
        code: 'INVALID_BYTECODE',
        message: 'Bytecode must have an even number of hex characters',
        path: 'bytecode',
      });
      return;
    }

    // Minimum length check (empty bytecode is invalid)
    if (hexPart.length < 2) {
      errors.push({
        severity: 'error',
        code: 'INVALID_BYTECODE',
        message: 'Bytecode is too short',
        path: 'bytecode',
      });
    }
  }

  private validateUIConfigs(
    params: ConstructorParam[],
    errors: ManifestIssue[]
  ): void {
    for (let i = 0; i < params.length; i++) {
      const param = params[i];

      // Safety check
      if (!param) continue;

      // Only user-input params require UI config
      if (param.source !== 'user-input') {
        continue;
      }

      if (!param.ui) {
        errors.push({
          severity: 'error',
          code: 'MISSING_UI_CONFIG',
          message: `User-input parameter "${param.name}" must have a "ui" configuration`,
          path: `constructorParams[${i}].ui`,
        });
        continue;
      }

      const ui = param.ui;

      // Validate UI config structure
      if (!ui.element || typeof ui.element !== 'string') {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" UI config must have an "element" field`,
          path: `constructorParams[${i}].ui.element`,
        });
      }

      if (!ui.label || typeof ui.label !== 'string') {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" UI config must have a "label" field`,
          path: `constructorParams[${i}].ui.label`,
        });
      }

      // Validate element type
      const validElements = [
        'text',
        'bigint',
        'number',
        'evm-address',
        'boolean',
        'hidden',
      ];
      if (ui.element && !validElements.includes(ui.element)) {
        errors.push({
          severity: 'error',
          code: 'INVALID_FIELD_VALUE',
          message: `Parameter "${param.name}" has invalid UI element "${ui.element}". Must be one of: ${validElements.join(', ')}`,
          path: `constructorParams[${i}].ui.element`,
        });
      }

      // Validate decimals for number type
      if (ui.element === 'number') {
        if (
          ui.decimals !== undefined &&
          (typeof ui.decimals !== 'number' || ui.decimals < 0)
        ) {
          errors.push({
            severity: 'error',
            code: 'INVALID_FIELD_VALUE',
            message: `Parameter "${param.name}" number input must have a non-negative "decimals" value`,
            path: `constructorParams[${i}].ui.decimals`,
          });
        }
      }
    }
  }

  private validateQuoteToken(
    quoteToken: unknown,
    errors: ManifestIssue[]
  ): ManifestQuoteToken | null {
    if (!quoteToken || typeof quoteToken !== 'object') {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: 'Field "quoteToken" must be an object',
        path: 'quoteToken',
      });
      return null;
    }

    const qt = quoteToken as Record<string, unknown>;

    // Validate type field
    if (!qt.type || typeof qt.type !== 'string') {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: 'Field "quoteToken.type" must be a string',
        path: 'quoteToken.type',
      });
      return null;
    }

    if (qt.type !== 'basic-currency' && qt.type !== 'erc20') {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: `Invalid quoteToken.type "${qt.type}". Must be "basic-currency" or "erc20"`,
        path: 'quoteToken.type',
      });
      return null;
    }

    // Validate symbol (required for both types)
    if (!qt.symbol || typeof qt.symbol !== 'string' || qt.symbol.trim() === '') {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: 'Field "quoteToken.symbol" must be a non-empty string',
        path: 'quoteToken.symbol',
      });
      return null;
    }

    if (qt.type === 'basic-currency') {
      return {
        type: 'basic-currency',
        symbol: qt.symbol as string,
      };
    }

    // ERC-20 type: validate chainId and address
    if (typeof qt.chainId !== 'number' || qt.chainId <= 0 || !Number.isInteger(qt.chainId)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: 'Field "quoteToken.chainId" must be a positive integer for ERC-20 tokens',
        path: 'quoteToken.chainId',
      });
      return null;
    }

    if (!qt.address || typeof qt.address !== 'string') {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: 'Field "quoteToken.address" must be a string for ERC-20 tokens',
        path: 'quoteToken.address',
      });
      return null;
    }

    // Validate address format (0x followed by 40 hex chars)
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(qt.address as string)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_QUOTE_TOKEN',
        message: 'Field "quoteToken.address" must be a valid EVM address (0x followed by 40 hex characters)',
        path: 'quoteToken.address',
      });
      return null;
    }

    return {
      type: 'erc20',
      symbol: qt.symbol as string,
      chainId: qt.chainId as number,
      address: qt.address as string,
    };
  }

  private validateFundingToken(
    fundingToken: unknown,
    errors: ManifestIssue[]
  ): ManifestFundingToken | null {
    if (!fundingToken || typeof fundingToken !== 'object') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FUNDING_TOKEN',
        message: 'Field "fundingToken" must be an object',
        path: 'fundingToken',
      });
      return null;
    }

    const ft = fundingToken as Record<string, unknown>;

    // Validate type field - must be 'erc20'
    if (ft.type !== 'erc20') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FUNDING_TOKEN',
        message: `Field "fundingToken.type" must be 'erc20'. Got: ${ft.type}`,
        path: 'fundingToken.type',
      });
      return null;
    }

    // Validate chainId - must be positive integer
    if (typeof ft.chainId !== 'number' || !Number.isInteger(ft.chainId) || ft.chainId <= 0) {
      errors.push({
        severity: 'error',
        code: 'INVALID_FUNDING_TOKEN',
        message: 'Field "fundingToken.chainId" must be a positive integer',
        path: 'fundingToken.chainId',
      });
      return null;
    }

    // Reject SEMSEE chain - funding token must be on public chain
    if (ft.chainId === 31337) {
      errors.push({
        severity: 'error',
        code: 'INVALID_FUNDING_TOKEN',
        message: 'Field "fundingToken.chainId" cannot be 31337 (SEMSEE). Use a public chain (e.g., 1 for Ethereum, 42161 for Arbitrum)',
        path: 'fundingToken.chainId',
      });
      return null;
    }

    // Validate address - must be valid EVM address format
    if (!ft.address || typeof ft.address !== 'string') {
      errors.push({
        severity: 'error',
        code: 'INVALID_FUNDING_TOKEN',
        message: 'Field "fundingToken.address" must be a string',
        path: 'fundingToken.address',
      });
      return null;
    }

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(ft.address)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_FUNDING_TOKEN',
        message: 'Field "fundingToken.address" must be a valid EVM address (0x followed by 40 hex characters)',
        path: 'fundingToken.address',
      });
      return null;
    }

    return {
      type: 'erc20',
      chainId: ft.chainId,
      address: ft.address,
    };
  }
}
