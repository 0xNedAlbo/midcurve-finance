// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, VaultState, Modifiers} from "../storage/AppStorage.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "../interfaces/IUniswapV3Factory.sol";
import {LibVault} from "../libraries/LibVault.sol";

/// @title InitFacet
/// @notice Handles vault initialization
/// @dev This facet is called once during diamond creation to set up the vault
contract InitFacet is Modifiers {
    // ============ Events ============

    event VaultInitialized(
        uint256 indexed positionId,
        uint256 initialShares,
        uint256 amount0,
        uint256 amount1
    );

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error EmptyPosition();
    error AlreadyInitialized();

    // ============ Initialization ============

    /// @notice Initialize the vault with chain constants and position data
    /// @dev Called by factory during diamond creation via delegatecall
    /// @param positionManager_ The Uniswap V3 NonfungiblePositionManager address
    /// @param augustusRegistry_ The Paraswap AugustusRegistry address
    /// @param positionId_ The Uniswap V3 position NFT ID
    /// @param manager_ The manager address (deployer)
    /// @param operator_ The operator address
    /// @param name_ The token name
    /// @param symbol_ The token symbol
    function initializeVault(
        address positionManager_,
        address augustusRegistry_,
        uint256 positionId_,
        address manager_,
        address operator_,
        string calldata name_,
        string calldata symbol_
    ) external {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.initialized) revert AlreadyInitialized();
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (augustusRegistry_ == address(0)) revert ZeroAddress();
        if (manager_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();

        // Set chain constants
        s.positionManager = positionManager_;
        s.augustusRegistry = augustusRegistry_;

        // Set position data
        s.positionId = positionId_;
        s.manager = manager_;
        s.operator = operator_;
        s.name = name_;
        s.symbol = symbol_;

        // Derive position data from NonfungiblePositionManager
        INonfungiblePositionManager pm = INonfungiblePositionManager(positionManager_);

        address factory_ = pm.factory();
        if (factory_ == address(0)) revert ZeroAddress();
        s.uniswapFactory = factory_;

        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower_,
            int24 tickUpper_,
            ,
            ,
            ,
            ,
        ) = pm.positions(positionId_);

        s.asset0 = token0;
        s.asset1 = token1;
        s.tickLower = tickLower_;
        s.tickUpper = tickUpper_;

        address pool_ = IUniswapV3Factory(factory_).getPool(token0, token1, fee);
        if (pool_ == address(0)) revert ZeroAddress();
        s.pool = pool_;

        // Initialize reentrancy lock
        s.reentrancyLock = 1;

        // Note: The vault is not fully initialized until init() is called with initial shares
    }

    /// @notice Complete vault initialization by transferring the position NFT
    /// @dev Must be called by the manager who owns the position NFT
    /// @param initialShares The initial shares to mint to the manager
    function init(uint256 initialShares) external {
        AppStorage storage s = LibAppStorage.appStorage();
        if (s.initialized) revert AlreadyInitialized();
        if (initialShares == 0) revert ZeroAmount();

        (uint256 amount0, uint256 amount1) = LibVault.getPositionAmounts();
        if (amount0 == 0 && amount1 == 0) revert EmptyPosition();

        // Transfer NFT from manager to vault
        INonfungiblePositionManager(s.positionManager).transferFrom(
            msg.sender,
            address(this),
            s.positionId
        );

        s.initialized = true;
        s.currentState = VaultState.IN_POSITION;

        // Mint initial shares to the caller (must be manager for NFT transfer)
        LibVault.mint(msg.sender, initialShares);

        emit VaultInitialized(s.positionId, initialShares, amount0, amount1);
    }
}
