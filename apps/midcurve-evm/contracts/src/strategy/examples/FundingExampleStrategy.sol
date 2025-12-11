// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseStrategy} from "../BaseStrategy.sol";
import {IStrategy} from "../../interfaces/IStrategy.sol";
import {FundingMixin} from "../FundingMixin.sol";
import {LoggingLib} from "../../libraries/LoggingLib.sol";

/**
 * @title FundingExampleStrategy
 * @notice Example strategy demonstrating the FundingMixin pattern
 * @dev Shows how to compose BaseStrategy with FundingMixin:
 *      - Extends BaseStrategy for lifecycle management
 *      - Extends FundingMixin for IFunding implementation
 *      - Bridges the two via abstract function implementations
 *      - Overrides only the hooks needed for custom behavior
 *
 * The mixin pattern allows combining multiple capabilities without
 * diamond inheritance issues. Each mixin requires bridge functions
 * that connect it to BaseStrategy's owner/state/effectId.
 *
 * Usage Example:
 * 1. Deploy: semsee deploy FundingExampleStrategy
 * 2. Start: semsee start <address>
 * 3. Deposit: Transfer tokens to automation wallet on external chain
 * 4. Withdraw: semsee withdraw erc20 <address> <chainId> <token> <amount>
 * 5. Check balance: semsee balance <address>
 */
contract FundingExampleStrategy is BaseStrategy, FundingMixin {
    using LoggingLib for *;

    // =========== Custom State ===========

    /// @notice Count of ERC-20 deposits received
    uint256 public erc20DepositCount;

    /// @notice Count of ETH balance updates received
    uint256 public ethBalanceUpdateCount;

    /// @notice Count of completed withdrawals
    uint256 public withdrawCompleteCount;

    /// @notice Last known ETH balance per chain
    mapping(uint256 => uint256) public lastEthBalance;

    // =========== Constructor ===========

    /**
     * @notice Deploy the strategy with specified owner
     * @param _owner The owner address (user's EOA)
     */
    constructor(address _owner) BaseStrategy(_owner) {
        LoggingLib.logInfo("FundingExampleStrategy deployed (not started)");
    }

    // =========== FundingMixin Bridge Functions ===========
    // These connect FundingMixin to BaseStrategy

    /**
     * @notice Bridge: Get owner address for FundingMixin
     */
    function _fundingOwner() internal view override returns (address) {
        return owner;
    }

    /**
     * @notice Bridge: Generate effect ID for FundingMixin
     */
    function _fundingNextEffectId() internal override returns (bytes32) {
        return _nextEffectId();
    }

    /**
     * @notice Bridge: Check running state for FundingMixin
     */
    function _fundingIsRunning() internal view override returns (bool) {
        return this.state() == IStrategy.StrategyState.Running;
    }

    // =========== Lifecycle Hooks ===========

    /**
     * @notice Called when strategy starts
     */
    function _onStart() internal override {
        LoggingLib.logInfo("FundingExampleStrategy started, ready for funding operations");
    }

    /**
     * @notice Called before shutdown
     */
    function _onShutdown() internal override {
        LoggingLib.logInfo("FundingExampleStrategy shutting down");
    }

    // =========== Funding Hooks ===========

    /**
     * @notice Called when ERC-20 deposit is received
     * @param chainId The chain where deposit was detected
     * @param token The ERC-20 token address
     * @param amount The amount deposited
     */
    function _onErc20Deposit(
        uint256 chainId,
        address token,
        uint256 amount
    ) internal override {
        erc20DepositCount++;

        LoggingLib.logInfo(
            "ERC-20 deposit received",
            abi.encode(chainId, token, amount, erc20DepositCount)
        );
    }

    /**
     * @notice Called when ETH balance is updated
     * @param chainId The chain where balance was polled
     * @param balance The current ETH balance
     */
    function _onEthBalanceUpdated(
        uint256 chainId,
        uint256 balance
    ) internal override {
        ethBalanceUpdateCount++;
        lastEthBalance[chainId] = balance;

        LoggingLib.logInfo(
            "ETH balance updated",
            abi.encode(chainId, balance, ethBalanceUpdateCount)
        );
    }

    /**
     * @notice Called when withdrawal completes
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
    ) internal override {
        withdrawCompleteCount++;

        if (success) {
            LoggingLib.logInfo(
                "Withdrawal completed successfully",
                abi.encode(requestId, txHash, withdrawCompleteCount)
            );
        } else {
            LoggingLib.logWarn(
                "Withdrawal failed",
                abi.encode(requestId, errorMessage)
            );
        }
    }

    // =========== View Functions ===========

    /**
     * @notice Get the last known ETH balance for a chain
     * @param chainId The chain ID
     * @return The last known balance (0 if never updated)
     */
    function getLastEthBalance(uint256 chainId) external view returns (uint256) {
        return lastEthBalance[chainId];
    }
}
