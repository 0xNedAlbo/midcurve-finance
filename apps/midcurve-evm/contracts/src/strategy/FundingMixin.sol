// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFunding} from "../interfaces/IFunding.sol";
import {CoreControlled} from "../libraries/CoreControlled.sol";
import {FundingLib} from "../libraries/FundingLib.sol";

/**
 * @title FundingMixin
 * @notice Mixin providing IFunding implementation with hook-based extensibility
 * @dev This is a composable mixin that does NOT inherit from BaseStrategy.
 *      Strategies should inherit from both BaseStrategy and FundingMixin separately.
 *      This avoids diamond inheritance issues when combining multiple mixins.
 *
 * Usage:
 * ```solidity
 * contract MyStrategy is BaseStrategy, FundingMixin {
 *     // Resolve the abstract requirements from FundingMixin
 *     function _fundingOwner() internal view override returns (address) {
 *         return owner;  // From BaseStrategy
 *     }
 *
 *     function _fundingNextEffectId() internal override returns (bytes32) {
 *         return _nextEffectId();  // From BaseStrategy
 *     }
 *
 *     function _fundingIsRunning() internal view override returns (bool) {
 *         return state() == StrategyState.Running;  // From BaseStrategy
 *     }
 *
 *     // Override hooks for custom behavior (all optional)
 *     function _onErc20Deposit(uint256 chainId, address token, uint256 amount) internal override {
 *         // Custom logic when deposit received
 *     }
 * }
 * ```
 *
 * Hooks available:
 * - _onErc20Deposit(chainId, token, amount) - Called when ERC-20 deposit detected
 * - _onEthBalanceUpdated(chainId, balance) - Called when ETH balance updated
 * - _onWithdrawComplete(requestId, success, txHash, errorMessage) - Called when withdrawal completes
 * - _beforeErc20Withdraw(chainId, token, amount) - Called before ERC-20 withdrawal request
 * - _beforeEthWithdraw(chainId, amount) - Called before ETH withdrawal request
 * - _beforeEthBalanceUpdate(chainId) - Called before ETH balance update request
 */
abstract contract FundingMixin is CoreControlled, IFunding {
    using FundingLib for *;

    // =========== State ===========

    /// @notice Track pending withdrawal requests
    mapping(bytes32 => bool) public pendingWithdrawals;

    /// @notice Count of pending withdrawals
    uint256 public pendingWithdrawalCount;

    // =========== Errors ===========

    /// @notice Error when caller is not the owner
    error FundingOnlyOwner();

    /// @notice Error when strategy is not running
    error FundingNotRunning();

    // =========== Abstract Requirements ===========
    // These must be implemented by the derived contract to bridge with BaseStrategy

    /**
     * @notice Get the owner address (bridge to BaseStrategy.owner)
     * @return The owner address
     */
    function _fundingOwner() internal view virtual returns (address);

    /**
     * @notice Generate the next effect ID (bridge to BaseStrategy._nextEffectId)
     * @return A unique effect ID
     */
    function _fundingNextEffectId() internal virtual returns (bytes32);

    /**
     * @notice Check if strategy is running (bridge to BaseStrategy.state)
     * @return True if the strategy is in Running state
     */
    function _fundingIsRunning() internal view virtual returns (bool);

    // =========== Internal Modifiers ===========

    /// @dev Modifier to restrict to owner (uses abstract bridge)
    modifier fundingOnlyOwner() {
        if (msg.sender != _fundingOwner()) revert FundingOnlyOwner();
        _;
    }

    /// @dev Modifier to restrict to running state (uses abstract bridge)
    modifier fundingOnlyRunning() {
        if (!_fundingIsRunning()) revert FundingNotRunning();
        _;
    }

    // =========== IFunding: Withdraw Functions (Owner Only) ===========

    /**
     * @notice Request withdrawal of ERC-20 tokens to owner wallet
     * @param chainId The chain where tokens are held
     * @param token The ERC-20 token address
     * @param amount The amount to withdraw
     * @return requestId Unique identifier for tracking this request
     */
    function withdrawErc20(
        uint256 chainId,
        address token,
        uint256 amount
    ) external override fundingOnlyOwner fundingOnlyRunning returns (bytes32 requestId) {
        // Before hook (can revert to prevent withdrawal)
        _beforeErc20Withdraw(chainId, token, amount);

        // Generate request ID and track
        requestId = _fundingNextEffectId();
        pendingWithdrawals[requestId] = true;
        pendingWithdrawalCount++;

        // Emit event for Core to process
        FundingLib.emitErc20WithdrawRequested(requestId, chainId, token, amount, _fundingOwner());
    }

    /**
     * @notice Request withdrawal of native ETH to owner wallet
     * @param chainId The chain where ETH is held
     * @param amount The amount to withdraw (in wei)
     * @return requestId Unique identifier for tracking this request
     */
    function withdrawEth(
        uint256 chainId,
        uint256 amount
    ) external override fundingOnlyOwner fundingOnlyRunning returns (bytes32 requestId) {
        // Before hook (can revert to prevent withdrawal)
        _beforeEthWithdraw(chainId, amount);

        // Generate request ID and track
        requestId = _fundingNextEffectId();
        pendingWithdrawals[requestId] = true;
        pendingWithdrawalCount++;

        // Emit event for Core to process
        FundingLib.emitEthWithdrawRequested(requestId, chainId, amount, _fundingOwner());
    }

    // =========== IFunding: Balance Update Functions (Owner Only) ===========

    /**
     * @notice Request Core to poll and update ETH balance
     * @dev Use after sending ETH to automation wallet on external chain
     * @param chainId The chain to poll ETH balance from
     * @return requestId Unique identifier for tracking this request
     */
    function updateEthBalance(
        uint256 chainId
    ) external override fundingOnlyOwner fundingOnlyRunning returns (bytes32 requestId) {
        // Before hook
        _beforeEthBalanceUpdate(chainId);

        // Generate request ID
        requestId = _fundingNextEffectId();

        // Emit event for Core to process
        FundingLib.emitEthBalanceUpdateRequested(requestId, chainId);
    }

    // =========== IFunding: Callbacks (Core Only) ===========

    /**
     * @notice Called by Core when ERC-20 deposit detected on external chain
     * @dev BalanceStore is updated BEFORE this callback is invoked
     * @param chainId The chain where deposit was detected
     * @param token The ERC-20 token address
     * @param amount The amount deposited
     */
    function onErc20Deposit(
        uint256 chainId,
        address token,
        uint256 amount
    ) external override onlyCore {
        _onErc20Deposit(chainId, token, amount);
    }

    /**
     * @notice Called by Core when ETH balance is updated
     * @dev BalanceStore is updated BEFORE this callback is invoked
     * @param chainId The chain where balance was polled
     * @param balance The current ETH balance
     */
    function onEthBalanceUpdated(
        uint256 chainId,
        uint256 balance
    ) external override onlyCore {
        _onEthBalanceUpdated(chainId, balance);
    }

    /**
     * @notice Called by Core when withdrawal completes on external chain
     * @dev BalanceStore is updated BEFORE this callback is invoked
     * @param requestId The original request identifier
     * @param success Whether the withdrawal succeeded
     * @param txHash The transaction hash on the external chain (0x0 if failed)
     * @param errorMessage Error description if failed, empty if success
     */
    function onWithdrawComplete(
        bytes32 requestId,
        bool success,
        bytes32 txHash,
        string calldata errorMessage
    ) external override onlyCore {
        // Clear pending status
        if (pendingWithdrawals[requestId]) {
            delete pendingWithdrawals[requestId];
            pendingWithdrawalCount--;
        }

        // Call hook
        _onWithdrawComplete(requestId, success, txHash, errorMessage);
    }

    // =========== View Functions ===========

    /**
     * @notice Check if a withdrawal request is pending
     * @param requestId The request ID to check
     * @return True if the withdrawal is still pending
     */
    function isWithdrawalPending(bytes32 requestId) external view returns (bool) {
        return pendingWithdrawals[requestId];
    }

    /**
     * @notice Check if there are any pending withdrawals
     * @return True if any withdrawals are pending
     */
    function hasPendingWithdrawals() external view returns (bool) {
        return pendingWithdrawalCount > 0;
    }

    // =========== Hooks (Override in derived contracts) ===========

    /**
     * @notice Hook called when ERC-20 deposit is received
     * @dev Override to add custom deposit handling logic
     * @param chainId The chain where deposit was detected
     * @param token The ERC-20 token address
     * @param amount The amount deposited
     */
    function _onErc20Deposit(
        uint256 chainId,
        address token,
        uint256 amount
    ) internal virtual {
        // Default: no-op, override in derived contract
    }

    /**
     * @notice Hook called when ETH balance is updated
     * @dev Override to add custom balance update handling logic
     * @param chainId The chain where balance was polled
     * @param balance The current ETH balance
     */
    function _onEthBalanceUpdated(
        uint256 chainId,
        uint256 balance
    ) internal virtual {
        // Default: no-op, override in derived contract
    }

    /**
     * @notice Hook called when withdrawal completes
     * @dev Override to add custom withdrawal completion logic
     * @param requestId The original request identifier
     * @param success Whether the withdrawal succeeded
     * @param txHash The transaction hash (0x0 if failed)
     * @param errorMessage Error description if failed
     */
    function _onWithdrawComplete(
        bytes32 requestId,
        bool success,
        bytes32 txHash,
        string calldata errorMessage
    ) internal virtual {
        // Default: no-op, override in derived contract
    }

    /**
     * @notice Hook called before ERC-20 withdrawal request
     * @dev Override to add validation or custom logic. Revert to prevent withdrawal.
     * @param chainId The chain where tokens are held
     * @param token The ERC-20 token address
     * @param amount The amount to withdraw
     */
    function _beforeErc20Withdraw(
        uint256 chainId,
        address token,
        uint256 amount
    ) internal virtual {
        // Default: no-op, override in derived contract
    }

    /**
     * @notice Hook called before ETH withdrawal request
     * @dev Override to add validation or custom logic. Revert to prevent withdrawal.
     * @param chainId The chain where ETH is held
     * @param amount The amount to withdraw
     */
    function _beforeEthWithdraw(
        uint256 chainId,
        uint256 amount
    ) internal virtual {
        // Default: no-op, override in derived contract
    }

    /**
     * @notice Hook called before ETH balance update request
     * @dev Override to add validation or custom logic. Revert to prevent update.
     * @param chainId The chain to poll ETH balance from
     */
    function _beforeEthBalanceUpdate(
        uint256 chainId
    ) internal virtual {
        // Default: no-op, override in derived contract
    }
}
