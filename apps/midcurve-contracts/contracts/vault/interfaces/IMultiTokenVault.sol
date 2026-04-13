// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ============ Structs ============

/// @notice Parameters for minting shares.
struct MintParams {
    /// @dev Maximum of each token the caller is willing to provide, indexed by tokenIndex.
    ///      Must have length == tokenCount(). Pass type(uint256).max to set no cap.
    uint256[] maxAmounts;
    /// @dev Minimum of each token the caller expects to be consumed, indexed by tokenIndex.
    ///      Passed through to the underlying liquidity provider (e.g. NFPM amount0Min/amount1Min).
    ///      Must have length == tokenCount(). Pass 0 to skip slippage check per token.
    uint256[] minAmounts;
    /// @dev Address that receives the minted shares.
    address recipient;
    /// @dev Transaction must be mined before this timestamp, or it reverts.
    uint256 deadline;
}

/// @notice Parameters for burning shares.
struct BurnParams {
    /// @dev Minimum token amounts the caller expects to receive, indexed by tokenIndex.
    ///      Must have length == tokenCount(). Pass 0 to skip slippage check per token.
    uint256[] minAmounts;
    /// @dev Address that receives the redeemed token amounts and any settled yield.
    address recipient;
    /// @dev Transaction must be mined before this timestamp, or it reverts.
    uint256 deadline;
}

// ============ Interface ============

/// @title IMultiTokenVault
/// @notice Generalized interface for vaults that tokenize arbitrary multi-token positions.
///
/// @dev Shares (ERC-20) represent proportional claims on both equity and yield.
///      balance / totalSupply == fractional ownership of all token amounts and all income streams.
///
///      Token set invariants:
///      - Tokens are fixed at construction. tokens(N) is immutable once set.
///      - tokenCount() == length of every tokenAmounts[] array returned or accepted.
///      - All getters accept tokenIndex (uint256), never tokenAddress.
///
///      Yield semantics:
///      - Yield (fees, rewards, base APR) accrues continuously and is separable from equity.
///      - collectYield() transfers yield without affecting share balance.
///      - Vaults where yield is embedded in equity appreciation (e.g. leveraged positions)
///        may implement collectYield() as a no-op returning a zero array.
///
///      Operator semantics:
///      - The operator may call tend() to execute predefined maintenance operations
///        (e.g. compounding, rebalancing, harvesting). The set of valid discriminators
///        and their parameter/result encoding is defined by the implementing contract.
///
///      vaultType() semantics:
///      - An opaque bytes32 identifier set immutably at construction.
///      - No on-chain registry. Meaning is assigned by the implementer and consumed
///        off-chain (e.g. for backend routing, frontend display, analytics).
interface IMultiTokenVault is IERC20 {

    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when shares are minted.
    /// @param minter       Address that initiated the mint and provided the tokens.
    /// @param recipient    Address that received the minted shares.
    /// @param shares       Number of shares minted.
    /// @param tokenAmounts Actual token amounts consumed, indexed by tokenIndex.
    event Minted(
        address indexed minter,
        address indexed recipient,
        uint256 shares,
        uint256[] tokenAmounts
    );

    /// @notice Emitted when shares are burned.
    /// @param burner       Address that burned the shares.
    /// @param recipient    Address that received the redeemed token amounts.
    /// @param shares       Number of shares burned.
    /// @param tokenAmounts Token amounts returned to recipient, indexed by tokenIndex.
    event Burned(
        address indexed burner,
        address indexed recipient,
        uint256 shares,
        uint256[] tokenAmounts
    );

    /// @notice Emitted when yield is collected.
    /// @param user         Address whose yield entitlement was collected.
    /// @param recipient    Address that received the yield tokens.
    /// @param tokenAmounts Yield amounts transferred, indexed by tokenIndex.
    event YieldCollected(
        address indexed user,
        address indexed recipient,
        uint256[] tokenAmounts
    );

    /// @notice Emitted when a tend() operation completes.
    /// @param operationDiscriminator Identifies which operation was executed.
    /// @param tendParams             ABI-encoded input parameters.
    /// @param tendResults            ABI-encoded result data. Schema is discriminator-specific.
    event TendExecuted(
        bytes32 indexed operationDiscriminator,
        bytes tendParams,
        bytes tendResults
    );

    /// @notice Emitted when the operator address changes.
    event OperatorUpdated(address indexed prevOperator, address indexed newOperator);

    // =========================================================================
    // Identification
    // =========================================================================

    /// @notice An opaque identifier describing the vault implementation type.
    function vaultType() external view returns (bytes32);

    // =========================================================================
    // Token set
    // =========================================================================

    /// @notice Number of tokens this vault operates with.
    function tokenCount() external view returns (uint256);

    /// @notice Returns the token address at a given index.
    /// @param index Token index in [0, tokenCount()).
    function tokens(uint256 index) external view returns (address);

    // =========================================================================
    // Operator
    // =========================================================================

    /// @notice The current operator address.
    function operator() external view returns (address);

    /// @notice Set a new operator.
    /// @dev Access-controlled to the vault owner / deployer.
    function setOperator(address newOperator) external;

    /// @notice Execute a predefined maintenance operation.
    /// @dev Only callable by the current operator.
    /// @param operationDiscriminator Identifies which operation to execute.
    /// @param tendParams             ABI-encoded input parameters for the operation.
    /// @return tendResults           ABI-encoded result data.
    function tend(bytes32 operationDiscriminator, bytes calldata tendParams)
        external
        returns (bytes memory tendResults);

    // =========================================================================
    // Core
    // =========================================================================

    /// @notice Mint shares by depositing proportional token amounts.
    /// @param minShares Minimum shares the caller expects to receive.
    /// @param params    See {MintParams}.
    /// @return shares       Actual number of shares minted.
    /// @return tokenAmounts Actual token amounts consumed, indexed by tokenIndex.
    function mint(uint256 minShares, MintParams calldata params)
        external
        returns (uint256 shares, uint256[] memory tokenAmounts);

    /// @notice Burn shares and receive proportional equity.
    /// @param shares Number of shares to burn.
    /// @param params See {BurnParams}.
    /// @return tokenAmounts Actual token amounts returned, indexed by tokenIndex.
    function burn(uint256 shares, BurnParams calldata params)
        external
        returns (uint256[] memory tokenAmounts);

    /// @notice Collect all accrued yield for msg.sender.
    /// @param recipient Address that receives the yield tokens.
    /// @return tokenAmounts Yield collected per token, indexed by tokenIndex.
    function collectYield(address recipient)
        external
        returns (uint256[] memory tokenAmounts);

    // =========================================================================
    // Views
    // =========================================================================

    /// @notice Returns the total token amounts held as equity by the vault.
    /// @dev Excludes uncollected yield. Represents the sum of all depositors' principal.
    /// @return tokenAmounts Total equity per token, indexed by tokenIndex.
    function totalAssets()
        external
        view
        returns (uint256[] memory tokenAmounts);

    /// @notice Returns the token amounts attributable to a given user's share balance.
    /// @dev Equivalent to totalAssets() * balanceOf(user) / totalSupply().
    ///      Excludes uncollected yield — use claimableYield() for that.
    /// @param user Address to query.
    /// @return tokenAmounts Principal per token, indexed by tokenIndex.
    function principalOf(address user)
        external
        view
        returns (uint256[] memory tokenAmounts);

    /// @notice Quote the token amounts required to mint a given number of shares.
    /// @param shares Number of shares to quote.
    /// @return tokenAmounts Token amounts per share, indexed by tokenIndex.
    function quoteMint(uint256 shares)
        external
        view
        returns (uint256[] memory tokenAmounts);

    /// @notice Quote the token amounts returned from burning a given number of shares.
    /// @param shares Number of shares to quote.
    /// @return tokenAmounts Token amounts per share, indexed by tokenIndex.
    function quoteBurn(uint256 shares)
        external
        view
        returns (uint256[] memory tokenAmounts);

    /// @notice Returns the total claimable yield for a given user.
    /// @param user Address to query.
    /// @return tokenAmounts Claimable yield per token, indexed by tokenIndex.
    function claimableYield(address user)
        external
        view
        returns (uint256[] memory tokenAmounts);
}
