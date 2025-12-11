// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFunding} from "../interfaces/IFunding.sol";
import {CoreControlled} from "../libraries/CoreControlled.sol";
import {FundingLib} from "../libraries/FundingLib.sol";
import {IBalanceStore} from "../interfaces/IBalanceStore.sol";
import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title FundingMixin
 * @notice Mixin providing IFunding implementation with hook-based extensibility
 * @dev This is a composable mixin that does NOT inherit from BaseStrategy.
 *      Strategies should inherit from both BaseStrategy and FundingMixin separately.
 *      This avoids diamond inheritance issues when combining multiple mixins.
 *
 * Authorization Model:
 * All owner-initiated actions require EIP-712 signatures:
 * - Users sign on Ethereum mainnet (chainId: 1), no network switch needed
 * - Automation wallet submits signed transactions to SEMSEE chain
 * - Contract verifies signature recovers to owner address
 *
 * Withdrawal Flow:
 * Withdrawals are initiated off-chain via signed requests to Core, not via contract calls.
 * This allows withdrawals to work regardless of strategy state.
 * 1. Owner signs withdrawal request (EIP-712) via CLI
 * 2. CLI submits signed request to Core
 * 3. Core verifies signature and executes withdrawal
 * 4. Core updates BalanceStore
 * 5. Core calls onWithdrawComplete() if strategy is Running
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
 * - _beforeEthBalanceUpdate(chainId) - Called before ETH balance update request
 */
abstract contract FundingMixin is CoreControlled, IFunding {
    using FundingLib for *;

    // =========== Constants ===========

    /// @notice SystemRegistry address (well-known precompile)
    ISystemRegistry internal constant SYSTEM_REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    // =========== EIP-712 Constants ===========

    /// @notice EIP-712 domain separator (chainId = 1 for Ethereum mainnet signing)
    /// @dev Users sign on mainnet, verification happens on SEMSEE chain
    bytes32 public constant FUNDING_DOMAIN_SEPARATOR = keccak256(abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId)"),
        keccak256("Semsee"),
        keccak256("1"),
        uint256(1)  // Ethereum mainnet
    ));

    /// @notice Type hash for UpdateEthBalance action
    bytes32 public constant UPDATE_ETH_BALANCE_TYPEHASH = keccak256(
        "UpdateEthBalance(address strategy,uint256 chainId,uint256 nonce,uint256 expiry)"
    );

    /// @notice Type hash for AddWatchedToken action
    bytes32 public constant ADD_WATCHED_TOKEN_TYPEHASH = keccak256(
        "AddWatchedToken(address strategy,uint256 chainId,address token,uint256 nonce,uint256 expiry)"
    );

    /// @notice Type hash for RemoveWatchedToken action
    bytes32 public constant REMOVE_WATCHED_TOKEN_TYPEHASH = keccak256(
        "RemoveWatchedToken(address strategy,uint256 chainId,address token,uint256 nonce,uint256 expiry)"
    );

    // =========== Nonce Tracking ===========

    /// @notice Tracks used nonces for replay protection (per-strategy)
    mapping(uint256 => bool) public fundingUsedNonces;

    // =========== Errors ===========

    /// @notice Error when signature has expired
    error FundingSignatureExpired();

    /// @notice Error when nonce has already been used
    error FundingNonceAlreadyUsed();

    /// @notice Error when signature is invalid (wrong signer)
    error FundingInvalidSignature();

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

    /**
     * @notice Modifier that verifies owner signature for protected funding actions
     * @dev Uses separate nonce tracking from BaseStrategy to avoid conflicts
     * @param structHash Pre-computed EIP-712 struct hash (includes all action parameters)
     * @param signature EIP-712 signature from the owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     */
    modifier withFundingOwnerSignature(
        bytes32 structHash,
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) {
        if (block.timestamp > expiry) revert FundingSignatureExpired();
        if (fundingUsedNonces[nonce]) revert FundingNonceAlreadyUsed();

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            FUNDING_DOMAIN_SEPARATOR,
            structHash
        ));

        address recovered = ECDSA.recover(digest, signature);
        if (recovered != _fundingOwner()) revert FundingInvalidSignature();

        fundingUsedNonces[nonce] = true;
        _;
    }

    /// @dev Modifier to restrict to running state (uses abstract bridge)
    modifier fundingOnlyRunning() {
        if (!_fundingIsRunning()) revert FundingNotRunning();
        _;
    }

    // =========== IFunding: Balance Update Functions (Signature Required) ===========

    /**
     * @notice Request Core to poll and update ETH balance
     * @dev Use after sending ETH to automation wallet on external chain
     * @param chainId The chain to poll ETH balance from
     * @param signature EIP-712 signature from owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     * @return requestId Unique identifier for tracking this request
     */
    function updateEthBalance(
        uint256 chainId,
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) external fundingOnlyRunning
        withFundingOwnerSignature(
            keccak256(abi.encode(UPDATE_ETH_BALANCE_TYPEHASH, address(this), chainId, nonce, expiry)),
            signature, nonce, expiry
        )
        returns (bytes32 requestId)
    {
        // Before hook
        _beforeEthBalanceUpdate(chainId);

        // Generate request ID
        requestId = _fundingNextEffectId();

        // Emit event for Core to process
        FundingLib.emitEthBalanceUpdateRequested(requestId, chainId);
    }

    // =========== IFunding: Legacy interface compatibility ===========

    /**
     * @notice Legacy function - reverts with guidance to use signature-based version
     * @dev This function is kept for interface compatibility but should not be used.
     *      Call updateEthBalance(chainId, signature, nonce, expiry) instead.
     */
    function updateEthBalance(uint256) external pure override returns (bytes32) {
        revert("Use updateEthBalance(chainId, signature, nonce, expiry)");
    }

    // =========== Token Watchlist Management (Signature Required) ===========

    /**
     * @notice Add a token to the deposit watchlist
     * @dev Core will start monitoring Transfer events for this token to the automation wallet.
     *      Call this after deploying/starting the strategy to enable deposit detection.
     * @param chainId The chain where the token is deployed (e.g., 1 for Ethereum, 42161 for Arbitrum)
     * @param token The ERC-20 token address to watch for deposits
     * @param signature EIP-712 signature from owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     */
    function addWatchedToken(
        uint256 chainId,
        address token,
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) external
        withFundingOwnerSignature(
            keccak256(abi.encode(ADD_WATCHED_TOKEN_TYPEHASH, address(this), chainId, token, nonce, expiry)),
            signature, nonce, expiry
        )
    {
        FundingLib.emitTokenWatchlistAdd(chainId, token);
    }

    /**
     * @notice Remove a token from the deposit watchlist
     * @dev Core will stop monitoring Transfer events for this token.
     *      Use when you no longer want to receive deposits of this token.
     * @param chainId The chain where the token is deployed
     * @param token The ERC-20 token address to stop watching
     * @param signature EIP-712 signature from owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     */
    function removeWatchedToken(
        uint256 chainId,
        address token,
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) external
        withFundingOwnerSignature(
            keccak256(abi.encode(REMOVE_WATCHED_TOKEN_TYPEHASH, address(this), chainId, token, nonce, expiry)),
            signature, nonce, expiry
        )
    {
        FundingLib.emitTokenWatchlistRemove(chainId, token);
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
     * @dev BalanceStore is updated BEFORE this callback is invoked.
     *      This is only called when strategy is Running.
     * @param requestId The request identifier (hash of signed message)
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
        // Call hook
        _onWithdrawComplete(requestId, success, txHash, errorMessage);
    }

    // =========== View Functions ===========

    /**
     * @notice Get the balance of a specific token on a specific chain
     * @dev Queries BalanceStore using this strategy as msg.sender
     * @param chainId The chain ID
     * @param token The token address
     * @return The token balance
     */
    function getBalance(uint256 chainId, address token) external view returns (uint256) {
        IBalanceStore balanceStore = IBalanceStore(SYSTEM_REGISTRY.balanceStore());
        return balanceStore.getBalance(chainId, token);
    }

    /**
     * @notice Get all balances on a specific chain
     * @dev Queries BalanceStore using this strategy as msg.sender
     * @param chainId The chain ID
     * @return Array of balance entries for all tracked tokens on the chain
     */
    function getAllBalances(uint256 chainId) external view returns (IBalanceStore.BalanceEntry[] memory) {
        IBalanceStore balanceStore = IBalanceStore(SYSTEM_REGISTRY.balanceStore());
        return balanceStore.getAllBalances(chainId);
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
     * @dev Override to add custom withdrawal completion logic.
     *      Only called when strategy is Running.
     * @param requestId The request identifier (hash of signed message)
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
