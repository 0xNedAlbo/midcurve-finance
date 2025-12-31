// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../BaseStrategy.sol";

/// @notice FundingMixin provides vault integration for strategy funding.
///
/// The strategy runs on SEMSEE (local chain) but funds live in a vault
/// on a public chain. This mixin provides:
/// - Step events: FUNDING_DEPOSITED, FUNDING_WITHDRAWN (notifications from vault)
/// - Effects: USE_FUNDS, RETURN_FUNDS (requests to vault)
///
/// The operator wallet acts as the bridge between chains.
/// Gas reimbursement is handled by the core orchestrator, not exposed here.
///
/// Fund flow:
/// - Vault -> Operator: via USE_FUNDS effect
/// - Operator -> Vault: via RETURN_FUNDS effect
///
abstract contract FundingMixin is BaseStrategy {
  // =============================================================
  // Effect Types
  // =============================================================

  /// @dev Effect: Request funds from vault to operator wallet
  bytes32 internal constant EFFECT_USE_FUNDS = keccak256("USE_FUNDS");

  /// @dev Effect: Return funds from operator wallet to vault
  bytes32 internal constant EFFECT_RETURN_FUNDS = keccak256("RETURN_FUNDS");

  // =============================================================
  // Step Event Types
  // =============================================================

  /// @dev Event type for funding notifications from vault watcher
  bytes32 internal constant STEP_EVENT_FUNDING = keccak256("STEP_EVENT_FUNDING");

  /// @dev Envelope version for funding event payload layout
  uint32 internal constant FUNDING_EVENT_VERSION = 1;

  /// @dev Funding event sub-type: user deposited to vault
  bytes32 internal constant FUNDING_DEPOSITED = keccak256("DEPOSITED");

  /// @dev Funding event sub-type: user withdrew from vault
  bytes32 internal constant FUNDING_WITHDRAWN = keccak256("WITHDRAWN");

  // =============================================================
  // State
  // =============================================================

  /// @dev Operator's current holding of funding tokens (in smallest units)
  /// This is the strategy's "available balance" for operations
  uint256 internal _operatorBalance;

  /// @dev Sequence number for effect idempotency keys
  uint64 internal _fundingSeq;

  // =============================================================
  // Errors
  // =============================================================

  error InsufficientOperatorBalance(uint256 requested, uint256 available);
  error UnsupportedFundingEventVersion(uint32 got);
  error UnknownFundingEventType(bytes32 eventType);

  // =============================================================
  // Effect Requests
  // =============================================================

  /// @notice Request funds from vault to operator wallet
  /// @param amount Amount of tokens to withdraw from vault (in smallest units)
  /// @return success True if effect completed successfully
  /// @dev The core orchestrator will:
  ///   1. Check vault has sufficient gas pool for tx
  ///   2. Call vault.useFunds(operator, amount) on public chain
  ///   3. Return result via submitEffectResult
  function _useFunds(uint256 amount) internal returns (bool success) {
    bytes32 key = keccak256(abi.encodePacked("use_funds", epoch(), _fundingSeq));
    bytes memory payload = abi.encode(amount);

    (AwaitStatus status, bytes memory data) = _awaitEffect(key, EFFECT_USE_FUNDS, payload);

    unchecked { _fundingSeq += 1; }

    if (status == AwaitStatus.READY_OK) {
      // Effect handler confirmed transfer completed
      // Data contains actual amount transferred
      uint256 actualAmount = abi.decode(data, (uint256));
      _operatorBalance += actualAmount;
      return true;
    }

    return false;
  }

  /// @notice Return funds from operator wallet to vault
  /// @param amount Amount of tokens to return to vault
  /// @return success True if effect completed successfully
  /// @dev The core orchestrator will:
  ///   1. Check vault has sufficient gas pool for tx
  ///   2. Call vault.returnFunds(amount) on public chain
  ///   3. Return result via submitEffectResult
  function _returnFunds(uint256 amount) internal returns (bool success) {
    if (amount > _operatorBalance) {
      revert InsufficientOperatorBalance(amount, _operatorBalance);
    }

    bytes32 key = keccak256(abi.encodePacked("return_funds", epoch(), _fundingSeq));
    bytes memory payload = abi.encode(amount);

    (AwaitStatus status, bytes memory data) = _awaitEffect(key, EFFECT_RETURN_FUNDS, payload);

    unchecked { _fundingSeq += 1; }

    if (status == AwaitStatus.READY_OK) {
      uint256 actualAmount = abi.decode(data, (uint256));
      _operatorBalance -= actualAmount;
      return true;
    }

    return false;
  }

  // =============================================================
  // State Accessors
  // =============================================================

  /// @notice Get operator's current token balance
  function operatorBalance() public view returns (uint256) {
    return _operatorBalance;
  }

  /// @notice Get current funding sequence number (for debugging)
  function fundingSequence() public view returns (uint64) {
    return _fundingSeq;
  }

  // =============================================================
  // Step Event Routing
  // =============================================================

  /// @dev Handle FUNDING step events (deposits/withdrawals)
  function _onStepEvent(bytes32 eventType, uint32 eventVersion, bytes memory payload)
    internal
    virtual
    override
  {
    if (eventType != STEP_EVENT_FUNDING) {
      super._onStepEvent(eventType, eventVersion, payload);
      return;
    }

    if (eventVersion != FUNDING_EVENT_VERSION) {
      revert UnsupportedFundingEventVersion(eventVersion);
    }

    // Decode: (fundingEventType, chainId, tokenAddress, amount, newVaultBalance)
    (
      bytes32 fundingEventType,
      uint256 chainId,
      address tokenAddress,
      uint256 amount,
      uint256 newVaultBalance
    ) = abi.decode(payload, (bytes32, uint256, address, uint256, uint256));

    if (fundingEventType == FUNDING_DEPOSITED) {
      _onFundingDeposited(chainId, tokenAddress, amount, newVaultBalance);
    } else if (fundingEventType == FUNDING_WITHDRAWN) {
      _onFundingWithdrawn(chainId, tokenAddress, amount, newVaultBalance);
    } else {
      revert UnknownFundingEventType(fundingEventType);
    }
  }

  // =============================================================
  // Hooks (override in strategy)
  // =============================================================

  /// @notice Called when owner deposits funds to vault
  /// @param chainId Public chain ID where vault lives
  /// @param tokenAddress ERC20 token address on that chain
  /// @param amount Amount deposited
  /// @param newVaultBalance New total vault balance
  function _onFundingDeposited(
    uint256 chainId,
    address tokenAddress,
    uint256 amount,
    uint256 newVaultBalance
  ) internal virtual {
    // Default: no-op. Override to react to deposits.
    chainId; tokenAddress; amount; newVaultBalance;
  }

  /// @notice Called when owner withdraws funds from vault
  /// @param chainId Public chain ID where vault lives
  /// @param tokenAddress ERC20 token address on that chain
  /// @param amount Amount withdrawn
  /// @param newVaultBalance New total vault balance
  function _onFundingWithdrawn(
    uint256 chainId,
    address tokenAddress,
    uint256 amount,
    uint256 newVaultBalance
  ) internal virtual {
    // Default: no-op. Override to react to withdrawals.
    chainId; tokenAddress; amount; newVaultBalance;
  }
}
