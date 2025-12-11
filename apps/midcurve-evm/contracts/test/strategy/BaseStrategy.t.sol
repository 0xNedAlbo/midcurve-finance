// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/strategy/BaseStrategy.sol";
import "../../src/interfaces/IStrategy.sol";

/// @dev Concrete implementation of BaseStrategy for testing
contract TestStrategy is BaseStrategy {
    bool public onStartCalled;
    bool public onShutdownCalled;

    constructor(address _owner) BaseStrategy(_owner) {}

    /// @dev Expose _nextEffectId for testing
    function nextEffectId() external returns (bytes32) {
        return _nextEffectId();
    }

    function _onStart() internal override {
        onStartCalled = true;
    }

    function _onShutdown() internal override {
        onShutdownCalled = true;
    }
}

contract BaseStrategyTest is Test {
    TestStrategy public strategy;

    // Test accounts
    uint256 constant OWNER_PRIVATE_KEY =
        0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    address public ownerAddress;
    address constant NON_OWNER = address(0xCAFE);

    event StrategyStarted();
    event StrategyShutdown();

    function setUp() public {
        ownerAddress = vm.addr(OWNER_PRIVATE_KEY);
        strategy = new TestStrategy(ownerAddress);
    }

    // =========== Helper Functions ===========

    /// @dev Generate EIP-712 signature for Start action
    function _signStart(
        uint256 privateKey,
        address strategyAddr,
        uint256 nonce,
        uint256 expiry
    ) internal pure returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Start(address strategy,uint256 nonce,uint256 expiry)"
                ),
                strategyAddr,
                nonce,
                expiry
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Generate EIP-712 signature for Shutdown action
    function _signShutdown(
        uint256 privateKey,
        address strategyAddr,
        uint256 nonce,
        uint256 expiry
    ) internal pure returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Shutdown(address strategy,uint256 nonce,uint256 expiry)"
                ),
                strategyAddr,
                nonce,
                expiry
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Return the domain separator (matches BaseStrategy.DOMAIN_SEPARATOR)
    function _domainSeparator() internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId)"
                    ),
                    keccak256("Semsee"),
                    keccak256("1"),
                    uint256(1) // Ethereum mainnet
                )
            );
    }

    // =========== Constructor Tests ===========

    function test_constructor_setsOwnerCorrectly() public view {
        assertEq(strategy.owner(), ownerAddress);
    }

    function test_constructor_setsStateToCreated() public view {
        assertEq(
            uint256(strategy.state()),
            uint256(IStrategy.StrategyState.Created)
        );
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(BaseStrategy.OwnerCannotBeZero.selector);
        new TestStrategy(address(0));
    }

    function test_registry_isCorrectAddress() public view {
        assertEq(
            address(strategy.REGISTRY()),
            0x0000000000000000000000000000000000001000
        );
    }

    // =========== Start Tests ===========

    function test_start_changesStateToRunning() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        strategy.start(signature, nonce, expiry);
        assertEq(
            uint256(strategy.state()),
            uint256(IStrategy.StrategyState.Running)
        );
    }

    function test_start_callsOnStartHook() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        assertFalse(strategy.onStartCalled());
        strategy.start(signature, nonce, expiry);
        assertTrue(strategy.onStartCalled());
    }

    function test_start_emitsStrategyStartedEvent() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        vm.expectEmit(true, true, true, true);
        emit StrategyStarted();
        strategy.start(signature, nonce, expiry);
    }

    function test_start_marksNonceAsUsed() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        assertFalse(strategy.usedNonces(nonce));
        strategy.start(signature, nonce, expiry);
        assertTrue(strategy.usedNonces(nonce));
    }

    function test_start_revertsIfNotSignedByOwner() public {
        uint256 wrongKey = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            wrongKey,
            address(strategy),
            nonce,
            expiry
        );

        vm.expectRevert(BaseStrategy.InvalidSignature.selector);
        strategy.start(signature, nonce, expiry);
    }

    function test_start_revertsIfSignatureExpired() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp - 1; // Already expired
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        vm.expectRevert(BaseStrategy.SignatureExpired.selector);
        strategy.start(signature, nonce, expiry);
    }

    function test_start_revertsIfNonceAlreadyUsed() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        strategy.start(signature, nonce, expiry);

        // Try to use the same nonce again (deploy new strategy to be in Created state)
        TestStrategy strategy2 = new TestStrategy(ownerAddress);
        _signStart(OWNER_PRIVATE_KEY, address(strategy2), nonce, expiry);

        // This should fail because nonce was already used in strategy1
        // But wait - nonces are per-strategy, so this won't fail
        // Let me test replay on same strategy instead

        // Can't start same strategy twice due to state check, but nonce is checked first
        // Let's test by checking if we can use a nonce that was already used
        vm.expectRevert(BaseStrategy.NonceAlreadyUsed.selector);
        strategy.start(signature, nonce, expiry);
    }

    function test_start_revertsIfAlreadyRunning() public {
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce2,
            expiry2
        );

        // Nonce check comes first in modifier, but nonce is fresh, so state check should trigger
        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Running,
                IStrategy.StrategyState.Created
            )
        );
        strategy.start(signature2, nonce2, expiry2);
    }

    function test_start_revertsIfShutdown() public {
        // Start
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        // Shutdown
        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce2,
            expiry2
        );
        strategy.shutdown(signature2, nonce2, expiry2);

        // Try to start again
        uint256 nonce3 = block.timestamp + 2;
        uint256 expiry3 = block.timestamp + 300;
        bytes memory signature3 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce3,
            expiry3
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Shutdown,
                IStrategy.StrategyState.Created
            )
        );
        strategy.start(signature3, nonce3, expiry3);
    }

    // =========== Shutdown Tests ===========

    function test_shutdown_changesStateToShutdown() public {
        // Start first
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        // Shutdown
        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce2,
            expiry2
        );
        strategy.shutdown(signature2, nonce2, expiry2);

        assertEq(
            uint256(strategy.state()),
            uint256(IStrategy.StrategyState.Shutdown)
        );
    }

    function test_shutdown_callsOnShutdownHook() public {
        // Start first
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        assertFalse(strategy.onShutdownCalled());

        // Shutdown
        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce2,
            expiry2
        );
        strategy.shutdown(signature2, nonce2, expiry2);

        assertTrue(strategy.onShutdownCalled());
    }

    function test_shutdown_emitsStrategyShutdownEvent() public {
        // Start first
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        // Shutdown
        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce2,
            expiry2
        );

        vm.expectEmit(true, true, true, true);
        emit StrategyShutdown();
        strategy.shutdown(signature2, nonce2, expiry2);
    }

    function test_shutdown_revertsIfNotSignedByOwner() public {
        // Start first
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        // Try shutdown with wrong key
        uint256 wrongKey = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;
        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signShutdown(
            wrongKey,
            address(strategy),
            nonce2,
            expiry2
        );

        vm.expectRevert(BaseStrategy.InvalidSignature.selector);
        strategy.shutdown(signature2, nonce2, expiry2);
    }

    function test_shutdown_revertsIfNotRunning() public {
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Created,
                IStrategy.StrategyState.Running
            )
        );
        strategy.shutdown(signature, nonce, expiry);
    }

    function test_shutdown_revertsIfAlreadyShutdown() public {
        // Start
        uint256 nonce1 = block.timestamp;
        uint256 expiry1 = block.timestamp + 300;
        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce1,
            expiry1
        );
        strategy.start(signature1, nonce1, expiry1);

        // Shutdown
        uint256 nonce2 = block.timestamp + 1;
        uint256 expiry2 = block.timestamp + 300;
        bytes memory signature2 = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce2,
            expiry2
        );
        strategy.shutdown(signature2, nonce2, expiry2);

        // Try shutdown again
        uint256 nonce3 = block.timestamp + 2;
        uint256 expiry3 = block.timestamp + 300;
        bytes memory signature3 = _signShutdown(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce3,
            expiry3
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Shutdown,
                IStrategy.StrategyState.Running
            )
        );
        strategy.shutdown(signature3, nonce3, expiry3);
    }

    // =========== Effect ID Tests ===========

    function test_nextEffectId_generatesUniqueIds() public {
        // Start strategy first
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );
        strategy.start(signature, nonce, expiry);

        bytes32 id1 = strategy.nextEffectId();
        bytes32 id2 = strategy.nextEffectId();
        bytes32 id3 = strategy.nextEffectId();

        assertTrue(id1 != id2, "First two IDs should be different");
        assertTrue(id2 != id3, "Second and third IDs should be different");
        assertTrue(id1 != id3, "First and third IDs should be different");
    }

    function test_nextEffectId_includesContractAddress() public {
        bytes32 id = strategy.nextEffectId();

        // Create another strategy and verify different IDs
        TestStrategy strategy2 = new TestStrategy(ownerAddress);
        bytes32 id2 = strategy2.nextEffectId();

        assertTrue(
            id != id2,
            "Different strategies should generate different IDs"
        );
    }

    // =========== Interface Tests ===========

    function test_implementsIStrategy() public view {
        // Verify that BaseStrategy implements IStrategy interface
        IStrategy iStrategy = IStrategy(address(strategy));
        assertEq(iStrategy.owner(), ownerAddress);
        assertEq(
            uint256(iStrategy.state()),
            uint256(IStrategy.StrategyState.Created)
        );
    }

    // =========== Domain Separator Tests ===========

    function test_domainSeparator_isCorrect() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId)"
                ),
                keccak256("Semsee"),
                keccak256("1"),
                uint256(1)
            )
        );
        assertEq(strategy.DOMAIN_SEPARATOR(), expected);
    }

    // =========== Signature Cross-Strategy Tests ===========

    function test_signature_cannotBeUsedOnDifferentStrategy() public {
        // Sign for strategy address
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;
        bytes memory signature = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );

        // Deploy another strategy with same owner
        TestStrategy strategy2 = new TestStrategy(ownerAddress);

        // Signature should be invalid for strategy2 because it was signed for strategy1's address
        vm.expectRevert(BaseStrategy.InvalidSignature.selector);
        strategy2.start(signature, nonce, expiry);
    }

    // =========== Nonce Isolation Tests ===========

    function test_nonces_arePerStrategy() public {
        // Use same nonce on two different strategies - should work
        uint256 nonce = block.timestamp;
        uint256 expiry = block.timestamp + 300;

        bytes memory signature1 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy),
            nonce,
            expiry
        );
        strategy.start(signature1, nonce, expiry);

        TestStrategy strategy2 = new TestStrategy(ownerAddress);
        bytes memory signature2 = _signStart(
            OWNER_PRIVATE_KEY,
            address(strategy2),
            nonce,
            expiry
        );
        strategy2.start(signature2, nonce, expiry); // Should succeed

        assertEq(
            uint256(strategy.state()),
            uint256(IStrategy.StrategyState.Running)
        );
        assertEq(
            uint256(strategy2.state()),
            uint256(IStrategy.StrategyState.Running)
        );
    }
}
