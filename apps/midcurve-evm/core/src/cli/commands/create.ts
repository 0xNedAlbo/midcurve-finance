import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to contracts directory (relative to this file in core/src/cli/commands/)
const CONTRACTS_DIR = join(__dirname, '../../../../contracts');

const STRATEGY_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseStrategy} from "../BaseStrategy.sol";
import {IOhlcConsumer} from "../../interfaces/IOhlcConsumer.sol";
import {OhlcCandle, TIMEFRAME_1M} from "../../types/OhlcCandle.sol";
import {OhlcConsumerLib} from "../../libraries/OhlcConsumerLib.sol";
import {ResourceIds} from "../../libraries/ResourceIds.sol";
import {LoggingLib} from "../../libraries/LoggingLib.sol";

/**
 * @title {{NAME}}
 * @notice Custom strategy implementation
 * @dev Extends BaseStrategy and implements IOhlcConsumer for price data
 *
 * Lifecycle:
 * 1. Deploy: Constructor configures markets, no subscriptions yet
 * 2. Start: Owner calls start(), subscription created in _onStart()
 * 3. Running: Receives OHLC candles via onOhlcCandle callback
 * 4. Shutdown: Owner calls shutdown(), subscription removed in _onShutdown()
 */
contract {{NAME}} is BaseStrategy, IOhlcConsumer {
    using OhlcConsumerLib for *;
    using LoggingLib for *;

    /// @notice The market ID for the target market
    bytes32 public immutable TARGET_MARKET;

    /// @notice Counter for received candles
    uint256 public candleCount;

    /**
     * @notice Deploy the strategy (owner = msg.sender)
     * @dev Only configuration happens here, no subscriptions yet
     */
    constructor() BaseStrategy() {
        // Configure your target market here
        TARGET_MARKET = ResourceIds.marketId("ETH", "USD");
        LoggingLib.logInfo("{{NAME}} deployed (not started)");
    }

    /**
     * @notice Set up subscriptions when started
     * @dev Called by BaseStrategy.start() after state changes to Running
     */
    function _onStart() internal override {
        OhlcConsumerLib.subscribeOhlc(TARGET_MARKET, TIMEFRAME_1M);
        LoggingLib.logInfo("{{NAME}} started, subscribed to market");
    }

    /**
     * @notice Remove subscriptions on shutdown
     * @dev Called by BaseStrategy.shutdown() before state changes to Shutdown
     */
    function _onShutdown() internal override {
        OhlcConsumerLib.unsubscribeOhlc(TARGET_MARKET, TIMEFRAME_1M);
        LoggingLib.logInfo("{{NAME}} shutdown, unsubscribed from market");
    }

    /**
     * @notice Called when a new OHLC candle closes
     * @param marketId The market identifier
     * @param timeframe The candle timeframe in minutes
     * @param candle The OHLC candle data
     */
    function onOhlcCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external override {
        // Note: We don't need onlyRunning here because:
        // 1. Before start(): No subscriptions, so no callbacks
        // 2. After shutdown(): Subscriptions removed, so no callbacks

        if (marketId == TARGET_MARKET && timeframe == TIMEFRAME_1M) {
            candleCount++;

            // TODO: Implement your strategy logic here
            // Example: Check if price crossed a threshold, emit action, etc.

            LoggingLib.logInfo(
                "Candle received",
                abi.encode(candle.timestamp, candle.close, candle.volume)
            );
        }
    }
}
`;

const TEST_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../../src/strategy/examples/{{NAME}}.sol";
import "../../../src/types/OhlcCandle.sol";

contract {{NAME}}Test is Test {
    {{NAME}} public strategy;

    function setUp() public {
        strategy = new {{NAME}}();
    }

    function test_constructor_setsOwner() public view {
        assertEq(strategy.owner(), address(this));
    }

    function test_constructor_setsCreatedState() public view {
        assertEq(uint256(strategy.state()), 0); // Created
    }

    function test_start_changesStateToRunning() public {
        strategy.start();
        assertEq(uint256(strategy.state()), 1); // Running
    }

    function test_start_onlyOwner() public {
        vm.prank(address(0xdead));
        vm.expectRevert();
        strategy.start();
    }

    function test_shutdown_changesStateToShutdown() public {
        strategy.start();
        strategy.shutdown();
        assertEq(uint256(strategy.state()), 2); // Shutdown
    }

    function test_shutdown_onlyOwner() public {
        strategy.start();
        vm.prank(address(0xdead));
        vm.expectRevert();
        strategy.shutdown();
    }

    function test_onOhlcCandle_incrementsCandleCount() public {
        strategy.start();

        OhlcCandle memory candle = OhlcCandle({
            timestamp: uint64(block.timestamp),
            open: 2000e18,
            high: 2010e18,
            low: 1990e18,
            close: 2005e18,
            volume: 1000e18
        });

        strategy.onOhlcCandle(
            strategy.TARGET_MARKET(),
            TIMEFRAME_1M,
            candle
        );

        assertEq(strategy.candleCount(), 1);
    }
}
`;

export const createCommand = new Command('create')
  .description('Generate a new strategy from template')
  .argument('<name>', 'Strategy name (e.g., MyStrategy)')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (name: string, options: { force?: boolean }) => {
    // Validate name
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      console.error(`\n❌ Invalid strategy name: ${name}`);
      console.error(`   Name must start with uppercase letter and contain only alphanumeric characters`);
      console.error(`   Example: MyStrategy, PriceAlertStrategy, RebalanceBot`);
      process.exit(1);
    }

    const strategyPath = join(CONTRACTS_DIR, `src/strategy/examples/${name}.sol`);
    const testDir = join(CONTRACTS_DIR, `test/strategy/examples`);
    const testPath = join(testDir, `${name}.t.sol`);

    // Check for existing files
    if (!options.force) {
      if (existsSync(strategyPath)) {
        console.error(`\n❌ Strategy file already exists: ${strategyPath}`);
        console.error(`   Use --force to overwrite`);
        process.exit(1);
      }
      if (existsSync(testPath)) {
        console.error(`\n❌ Test file already exists: ${testPath}`);
        console.error(`   Use --force to overwrite`);
        process.exit(1);
      }
    }

    // Ensure test directory exists
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Generate files
    const strategyCode = STRATEGY_TEMPLATE.replace(/{{NAME}}/g, name);
    const testCode = TEST_TEMPLATE.replace(/{{NAME}}/g, name);

    writeFileSync(strategyPath, strategyCode);
    writeFileSync(testPath, testCode);

    console.log(`\n✅ Created strategy:`);
    console.log(`   ${strategyPath}`);
    console.log(`\n✅ Created test:`);
    console.log(`   ${testPath}`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Edit the strategy: code ${strategyPath}`);
    console.log(`   2. Run tests:         npm run test:contracts`);
    console.log(`   3. Deploy:            npm run strategy:deploy ${name}`);
    console.log(`   4. Start:             npm run strategy:start <address>`);
    console.log(`   5. Watch logs:        npm run strategy:logs <address>`);
    console.log('');
  });
