// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseFunding} from "../BaseFunding.sol";
import {LoggingLib} from "../../libraries/LoggingLib.sol";

/**
 * @title FundingExampleStrategy
 * @notice Example strategy demonstrating the BaseFunding mixin
 * @dev Shows how to use BaseFunding with minimal code by:
 *      - Extending BaseFunding for complete IFunding implementation
 *      - Overriding only the hooks needed for custom behavior
 *      - Using LoggingLib for debugging
 *
 * All IFunding methods (withdrawErc20, withdrawEth, updateEthBalance, callbacks)
 * are already implemented by BaseFunding. This strategy only adds:
 * - Custom state tracking (deposit counts, last ETH balance)
 * - Logging for debugging
 *
 * Usage Example:
 * 1. Deploy: semsee deploy FundingExampleStrategy
 * 2. Start: semsee start <address>
 * 3. Deposit: Transfer tokens to automation wallet on external chain
 * 4. Withdraw: semsee withdraw erc20 <address> <chainId> <token> <amount>
 * 5. Check balance: semsee balance <address>
 */
contract FundingExampleStrategy is BaseFunding {
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
     * @notice Deploy the strategy (owner = msg.sender)
     */
    constructor() BaseFunding() {
        LoggingLib.logInfo("FundingExampleStrategy deployed (not started)");
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
