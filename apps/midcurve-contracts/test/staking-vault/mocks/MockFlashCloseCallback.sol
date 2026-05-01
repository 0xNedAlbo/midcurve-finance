// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IFlashCloseCallback} from
    "../../../contracts/staking-vault/interfaces/IFlashCloseCallback.sol";
import {IStakingVault} from "../../../contracts/staking-vault/interfaces/IStakingVault.sol";

/// @notice Configurable flash-close callback for testing.
///         Modes:
///           Exact     — return exactly (expectedBase, expectedQuote)
///           Surplus   — return more than required (extra goes to ClaimRewards)
///           Insufficient — return less than required (vault must revert)
///           Reentrant — attempt to reenter the vault during the callback
contract MockFlashCloseCallback is IFlashCloseCallback {
    enum Mode {
        Exact,
        SurplusBase,
        SurplusQuote,
        InsufficientBase,
        InsufficientQuote,
        ReentrantSwap,
        ReentrantClaim
    }

    address public vault;
    IERC20 public baseToken;
    IERC20 public quoteToken;
    Mode public mode;

    uint256 public surplusBase;
    uint256 public surplusQuote;

    constructor(address vault_, IERC20 baseToken_, IERC20 quoteToken_) {
        vault = vault_;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setSurplus(uint256 surplusBase_, uint256 surplusQuote_) external {
        surplusBase = surplusBase_;
        surplusQuote = surplusQuote_;
    }

    function flashCloseCallback(uint256 expectedBase, uint256 expectedQuote, bytes calldata)
        external
        override
    {
        // First, simulate "swap external assets in to make up the deficit." For this mock
        // we just rely on the test having pre-funded this contract with extra tokens.
        if (mode == Mode.Exact) {
            baseToken.transfer(vault, expectedBase);
            quoteToken.transfer(vault, expectedQuote);
        } else if (mode == Mode.SurplusBase) {
            baseToken.transfer(vault, expectedBase + surplusBase);
            quoteToken.transfer(vault, expectedQuote);
        } else if (mode == Mode.SurplusQuote) {
            baseToken.transfer(vault, expectedBase);
            quoteToken.transfer(vault, expectedQuote + surplusQuote);
        } else if (mode == Mode.InsufficientBase) {
            // Return less than required base
            if (expectedBase > 0) {
                baseToken.transfer(vault, expectedBase - 1);
            }
            quoteToken.transfer(vault, expectedQuote);
        } else if (mode == Mode.InsufficientQuote) {
            baseToken.transfer(vault, expectedBase);
            if (expectedQuote > 0) {
                quoteToken.transfer(vault, expectedQuote - 1);
            }
        } else if (mode == Mode.ReentrantSwap) {
            // Try to reenter swap during the callback — must revert (nonReentrant).
            IStakingVault(vault).swap(address(0), 0, address(0), 0);
            // Unreachable.
            baseToken.transfer(vault, expectedBase);
            quoteToken.transfer(vault, expectedQuote);
        } else if (mode == Mode.ReentrantClaim) {
            IStakingVault(vault).claimRewards();
            baseToken.transfer(vault, expectedBase);
            quoteToken.transfer(vault, expectedQuote);
        }
    }
}
