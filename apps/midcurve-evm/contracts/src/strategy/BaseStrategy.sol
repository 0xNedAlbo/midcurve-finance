// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStrategy} from "../interfaces/IStrategy.sol";
import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {LoggingLib} from "../libraries/LoggingLib.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BaseStrategy
 * @notice Minimal base contract for SEMSEE strategies with EIP-712 signature authorization
 * @dev Provides essential infrastructure:
 *      - Owner management (owner set at construction, immutable)
 *      - Lifecycle management (Created -> Running -> Shutdown)
 *      - EIP-712 signature verification for owner actions
 *      - Effect ID generation for tracking async actions
 *      - Access to SystemRegistry
 *      - Logging via LoggingLib
 *
 * Strategies extend this and implement module interfaces:
 * - IOhlcConsumer for price data
 * - IPoolConsumer for pool state
 * - IBalanceConsumer for balance updates
 * - IUniswapV3Actions for position management
 * - IFunding for deposits and withdrawals
 *
 * Authorization Model:
 * - Owner is set at deployment (immutable)
 * - All owner actions require EIP-712 signature verification
 * - Users sign on Ethereum mainnet (chainId: 1), no network switch needed
 * - Automation wallet submits signed transactions to SEMSEE chain
 *
 * Lifecycle:
 * 1. Deploy: Constructor runs with owner address, state = Created
 * 2. Start: Signed start() called, _onStart() hook runs, state = Running
 * 3. Shutdown: Signed shutdown() called, _onShutdown() hook runs, state = Shutdown
 */
contract BaseStrategy is IStrategy {
    using LoggingLib for *;

    // =========== System Constants ===========

    /// @notice The well-known address of the SystemRegistry
    ISystemRegistry public constant REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    // =========== EIP-712 Constants ===========

    /// @notice EIP-712 domain separator (chainId = 1 for Ethereum mainnet signing)
    /// @dev Users sign on mainnet, verification happens on SEMSEE chain
    bytes32 public constant DOMAIN_SEPARATOR = keccak256(abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId)"),
        keccak256("Semsee"),
        keccak256("1"),
        uint256(1)  // Ethereum mainnet
    ));

    /// @notice Type hash for Start action
    bytes32 public constant START_TYPEHASH = keccak256(
        "Start(address strategy,uint256 nonce,uint256 expiry)"
    );

    /// @notice Type hash for Shutdown action
    bytes32 public constant SHUTDOWN_TYPEHASH = keccak256(
        "Shutdown(address strategy,uint256 nonce,uint256 expiry)"
    );

    // =========== Owner ===========

    /// @notice The owner address of this strategy (set at deployment)
    address public immutable override owner;

    // =========== Lifecycle State ===========

    /// @notice Current lifecycle state
    StrategyState internal _state;

    // =========== Effect Tracking ===========

    /// @dev Counter for generating unique effect IDs
    uint256 private _effectCounter;

    // =========== Nonce Tracking ===========

    /// @notice Tracks used nonces for replay protection
    mapping(uint256 => bool) public usedNonces;

    // =========== Errors ===========

    /// @notice Error when signature has expired
    error SignatureExpired();

    /// @notice Error when nonce has already been used
    error NonceAlreadyUsed();

    /// @notice Error when signature is invalid (wrong signer)
    error InvalidSignature();

    /// @notice Error when operation not allowed in current state
    error InvalidState(StrategyState current, StrategyState required);

    /// @notice Error when owner address is zero
    error OwnerCannotBeZero();

    // =========== Constructor ===========

    /**
     * @notice Initialize the strategy with the specified owner
     * @param _owner The owner address (user's EOA)
     * @dev Owner is set by the automation wallet at deployment
     */
    constructor(address _owner) {
        if (_owner == address(0)) revert OwnerCannotBeZero();
        owner = _owner;
        _state = StrategyState.Created;
    }

    // =========== EIP-712 Signature Verification ===========

    /**
     * @notice Modifier that verifies owner signature for protected actions
     * @dev Accepts pre-computed structHash to support variable parameters (e.g., withdraw)
     * @param structHash Pre-computed EIP-712 struct hash (includes all action parameters)
     * @param signature EIP-712 signature from the owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     */
    modifier withOwnerSignature(
        bytes32 structHash,
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) {
        if (block.timestamp > expiry) revert SignatureExpired();
        if (usedNonces[nonce]) revert NonceAlreadyUsed();

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        address recovered = ECDSA.recover(digest, signature);
        if (recovered != owner) revert InvalidSignature();

        usedNonces[nonce] = true;
        _;
    }

    // =========== Lifecycle ===========

    /// @notice Returns current state
    function state() external view override returns (StrategyState) {
        return _state;
    }

    /// @notice Modifier to restrict to Running state
    modifier onlyRunning() {
        if (_state != StrategyState.Running) {
            revert InvalidState(_state, StrategyState.Running);
        }
        _;
    }

    /**
     * @notice Start the strategy with owner signature
     * @param signature EIP-712 signature from owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     */
    function start(
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) external virtual override
        withOwnerSignature(
            keccak256(abi.encode(START_TYPEHASH, address(this), nonce, expiry)),
            signature, nonce, expiry
        )
    {
        if (_state != StrategyState.Created) {
            revert InvalidState(_state, StrategyState.Created);
        }

        _state = StrategyState.Running;
        _onStart(); // Hook for subclasses
        emit StrategyStarted();
    }

    /**
     * @notice Shutdown the strategy with owner signature
     * @param signature EIP-712 signature from owner
     * @param nonce Timestamp-based nonce for replay protection
     * @param expiry Signature expiry timestamp
     */
    function shutdown(
        bytes calldata signature,
        uint256 nonce,
        uint256 expiry
    ) external virtual override
        withOwnerSignature(
            keccak256(abi.encode(SHUTDOWN_TYPEHASH, address(this), nonce, expiry)),
            signature, nonce, expiry
        )
    {
        if (_state != StrategyState.Running) {
            revert InvalidState(_state, StrategyState.Running);
        }

        _onShutdown(); // Hook for subclasses - unsubscribe here
        _state = StrategyState.Shutdown;
        emit StrategyShutdown();
    }

    /// @notice Hook called when strategy starts - override to set up subscriptions
    function _onStart() internal virtual {}

    /// @notice Hook called before shutdown - override to remove subscriptions
    function _onShutdown() internal virtual {}

    // =========== Effect ID Generation ===========

    /**
     * @notice Generate a unique effect ID for tracking async actions
     * @dev Effect IDs are used to correlate action requests with their results
     * @return A unique bytes32 identifier for the effect
     */
    function _nextEffectId() internal returns (bytes32) {
        _effectCounter++;
        return keccak256(abi.encodePacked(address(this), _effectCounter));
    }
}
