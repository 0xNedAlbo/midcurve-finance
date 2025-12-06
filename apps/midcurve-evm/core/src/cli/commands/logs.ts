import { Command } from 'commander';
import { createPublicClient, webSocket, http, decodeEventLog, type Address, type Log } from 'viem';
import { semseeChain } from '../../vm/chain.js';
import { LOG_MESSAGE_ABI, LOG_LEVELS, LOG_LEVEL_NAMES } from '../abis.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
};

function colorForLevel(level: number): string {
  switch (level) {
    case 0: return colors.gray;   // DEBUG
    case 1: return colors.blue;   // INFO
    case 2: return colors.yellow; // WARN
    case 3: return colors.red;    // ERROR
    default: return colors.reset;
  }
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(11, 23);
}

function decodeLogData(data: `0x${string}`): string {
  if (data === '0x' || data.length <= 2) {
    return '';
  }

  try {
    // Try to decode as a simple hex string first
    // For now, just show the hex - proper decoding would need ABI info
    return ` | data: ${data.slice(0, 66)}${data.length > 66 ? '...' : ''}`;
  } catch {
    return ` | data: ${data.slice(0, 34)}...`;
  }
}

export const logsCommand = new Command('logs')
  .description('Watch strategy logs in real-time')
  .argument('<address>', 'Strategy contract address')
  .option('-l, --level <level>', 'Minimum log level (debug|info|warn|error)', 'debug')
  .option('--no-color', 'Disable colored output')
  .option('-f, --follow', 'Keep watching for new logs (default: true)', true)
  .action(async (address: string, options: { level: string; color: boolean; follow: boolean }) => {
    const strategyAddress = address as Address;
    const minLevel = LOG_LEVELS[options.level.toUpperCase() as keyof typeof LOG_LEVELS] ?? 0;
    const useColor = options.color !== false;

    console.log(`\n📋 Watching logs for ${strategyAddress}`);
    console.log(`   Minimum level: ${options.level.toUpperCase()}`);
    console.log(`   Press Ctrl+C to stop\n`);
    console.log(`${'─'.repeat(80)}\n`);

    // Try WebSocket first, fall back to HTTP polling
    let client;
    let usePolling = false;

    try {
      client = createPublicClient({
        chain: semseeChain,
        transport: webSocket('ws://localhost:8546'),
      });
      // Test the connection
      await client.getBlockNumber();
    } catch {
      console.log('   (WebSocket unavailable, using HTTP polling)\n');
      usePolling = true;
      client = createPublicClient({
        chain: semseeChain,
        transport: http(),
      });
    }

    const processLog = (log: Log) => {
      try {
        const decoded = decodeEventLog({
          abi: LOG_MESSAGE_ABI,
          data: log.data,
          topics: log.topics,
        });

        const level = Number(decoded.args.level);
        if (level < minLevel) return;

        const levelName = LOG_LEVEL_NAMES[level] || 'UNKNOWN';

        const color = useColor ? colorForLevel(level) : '';
        const reset = useColor ? colors.reset : '';
        const timestamp = formatTimestamp();
        const dataStr = decodeLogData(decoded.args.data as `0x${string}`);

        console.log(`${colors.gray}${timestamp}${reset} ${color}[${levelName}]${reset} ${decoded.args.message}${dataStr}`);
      } catch (error) {
        // Silently ignore non-LogMessage events
      }
    };

    if (usePolling) {
      // HTTP polling mode
      let lastBlock = await client.getBlockNumber();

      const poll = async () => {
        try {
          const currentBlock = await client.getBlockNumber();
          if (currentBlock > lastBlock) {
            const logs = await client.getLogs({
              address: strategyAddress,
              event: {
                type: 'event',
                name: 'LogMessage',
                inputs: [
                  { type: 'uint8', name: 'level', indexed: true },
                  { type: 'string', name: 'message', indexed: false },
                  { type: 'bytes', name: 'data', indexed: false },
                ],
              },
              fromBlock: lastBlock + 1n,
              toBlock: currentBlock,
            });

            for (const log of logs) {
              processLog(log);
            }

            lastBlock = currentBlock;
          }
        } catch (error) {
          // Silently continue on polling errors
        }
      };

      // Poll every 2 seconds
      const intervalId = setInterval(poll, 2000);

      // Initial poll
      await poll();

      // Handle cleanup
      process.on('SIGINT', () => {
        clearInterval(intervalId);
        console.log('\n\n📋 Stopped watching logs');
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    } else {
      // WebSocket mode
      const unwatch = client.watchEvent({
        address: strategyAddress,
        event: {
          type: 'event',
          name: 'LogMessage',
          inputs: [
            { type: 'uint8', name: 'level', indexed: true },
            { type: 'string', name: 'message', indexed: false },
            { type: 'bytes', name: 'data', indexed: false },
          ],
        },
        onLogs: (logs) => {
          for (const log of logs) {
            processLog(log);
          }
        },
        onError: (error) => {
          console.error(`\n❌ WebSocket error: ${error.message}`);
        },
      });

      // Handle cleanup
      process.on('SIGINT', () => {
        unwatch();
        console.log('\n\n📋 Stopped watching logs');
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    }
  });
