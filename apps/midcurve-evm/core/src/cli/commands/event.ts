import { Command } from 'commander';
import { createWalletClient, createPublicClient, http, keccak256, toHex, parseUnits, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { semseeChain } from '../../vm/chain.js';
import { CORE_PRIVATE_KEY } from '../../utils/addresses.js';
import { OHLC_CONSUMER_ABI, STRATEGY_ABI, STRATEGY_STATES } from '../abis.js';

export const eventCommand = new Command('event')
  .description('Send test events to a strategy');

// OHLC subcommand
eventCommand
  .command('ohlc <address>')
  .description('Send an OHLC candle event to a strategy')
  .option('-m, --market <market>', 'Market pair (e.g., ETH/USD)', 'ETH/USD')
  .option('-t, --timeframe <timeframe>', 'Timeframe in minutes', '1')
  .option('-p, --price <price>', 'Close price (e.g., 2000)', '2000')
  .option('--open <open>', 'Open price (default: same as price)')
  .option('--high <high>', 'High price (default: price + 1%)')
  .option('--low <low>', 'Low price (default: price - 1%)')
  .option('--volume <volume>', 'Volume (default: 1000)', '1000')
  .action(async (address: string, options: {
    market: string;
    timeframe: string;
    price: string;
    open?: string;
    high?: string;
    low?: string;
    volume: string;
  }) => {
    const strategyAddress = address as Address;

    const account = privateKeyToAccount(CORE_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account,
      chain: semseeChain,
      transport: http(),
    });
    const publicClient = createPublicClient({
      chain: semseeChain,
      transport: http(),
    });

    try {
      // Check strategy state
      const currentState = await publicClient.readContract({
        address: strategyAddress,
        abi: STRATEGY_ABI,
        functionName: 'state',
      });

      const stateIndex = Number(currentState);
      if (stateIndex !== 1) {
        console.error(`\n❌ Cannot send event to strategy`);
        console.error(`   Current state: ${STRATEGY_STATES[stateIndex]}`);
        console.error(`   Strategy must be in 'Running' state to receive events`);
        process.exit(1);
      }

      // Parse market pair to generate market ID
      const [base, quote] = options.market.split('/');
      if (!base || !quote) {
        console.error(`\n❌ Invalid market format: ${options.market}`);
        console.error(`   Use format like: ETH/USD, BTC/USD`);
        process.exit(1);
      }

      // Generate market ID the same way ResourceIds.sol does
      const marketId = keccak256(toHex(`${base}/${quote}`));

      // Parse prices (18 decimals)
      const closePrice = parseUnits(options.price, 18);
      const openPrice = options.open ? parseUnits(options.open, 18) : closePrice;
      const highPrice = options.high
        ? parseUnits(options.high, 18)
        : closePrice + (closePrice / 100n); // +1%
      const lowPrice = options.low
        ? parseUnits(options.low, 18)
        : closePrice - (closePrice / 100n); // -1%
      const volume = parseUnits(options.volume, 18);
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const timeframe = parseInt(options.timeframe);

      const candle = {
        timestamp,
        open: openPrice,
        high: highPrice,
        low: lowPrice,
        close: closePrice,
        volume,
      };

      console.log(`\n📊 Sending OHLC candle to ${strategyAddress}`);
      console.log(`   Market:    ${options.market} (${marketId.slice(0, 18)}...)`);
      console.log(`   Timeframe: ${timeframe}m`);
      console.log(`   Open:      ${options.open || options.price}`);
      console.log(`   High:      ${options.high || `${options.price} + 1%`}`);
      console.log(`   Low:       ${options.low || `${options.price} - 1%`}`);
      console.log(`   Close:     ${options.price}`);
      console.log(`   Volume:    ${options.volume}`);
      console.log(`   Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);

      const hash = await walletClient.writeContract({
        address: strategyAddress,
        abi: OHLC_CONSUMER_ABI,
        functionName: 'onOhlcCandle',
        args: [marketId, timeframe, candle],
      });

      console.log(`\n   TX Hash: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        console.log(`\n✅ OHLC event sent successfully!`);

        // Check if any logs were emitted
        if (receipt.logs.length > 0) {
          console.log(`   ${receipt.logs.length} log(s) emitted by strategy`);
        }
        console.log('');
      } else {
        console.error(`\n❌ Transaction failed`);
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\n❌ Error: ${error.message}`);
      } else {
        console.error('\n❌ Unknown error occurred');
      }
      process.exit(1);
    }
  });

// Future: Add more event types
// eventCommand.command('pool <address>').description('Send a pool state update event');
// eventCommand.command('position <address>').description('Send a position update event');
// eventCommand.command('balance <address>').description('Send a balance update event');
