#!/usr/bin/env node
import { Command } from 'commander';
import { deployCommand } from './commands/deploy.js';
import { startCommand } from './commands/start.js';
import { shutdownCommand } from './commands/shutdown.js';
import { logsCommand } from './commands/logs.js';
import { eventCommand } from './commands/event.js';
import { statusCommand } from './commands/status.js';
import { fundCommand } from './commands/fund.js';
import { createCommand } from './commands/create.js';

const program = new Command();

program
  .name('semsee')
  .description('SEMSEE Strategy Development CLI')
  .version('0.1.0');

// Strategy lifecycle commands
program.addCommand(createCommand);
program.addCommand(deployCommand);
program.addCommand(startCommand);
program.addCommand(shutdownCommand);

// Monitoring commands
program.addCommand(statusCommand);
program.addCommand(logsCommand);

// Testing commands
program.addCommand(eventCommand);

// Utility commands
program.addCommand(fundCommand);

// Custom help footer
program.addHelpText('after', `

Examples:
  $ semsee create MyStrategy            Generate a new strategy from template
  $ semsee deploy MyStrategy            Compile and deploy a strategy
  $ semsee deploy MyStrategy --start    Deploy and immediately start
  $ semsee start 0x1234...              Start a deployed strategy
  $ semsee logs 0x1234...               Watch strategy logs in real-time
  $ semsee event ohlc 0x1234...         Send test OHLC event
  $ semsee status                       Show system status
  $ semsee status 0x1234...             Show strategy status
  $ semsee shutdown 0x1234...           Shutdown a running strategy
  $ semsee fund 0x1234... 100           Fund an account with 100 ETH

Workflow:
  1. npm run up                         Start the SEMSEE node (Geth + stores)
  2. npm run strategy:create MyStrategy Generate strategy template
  3. Edit contracts/src/strategy/examples/MyStrategy.sol
  4. npm run strategy:deploy MyStrategy Deploy the strategy
  5. npm run strategy:start <address>   Start the strategy
  6. npm run strategy:logs <address>    Watch logs (in another terminal)
  7. npm run strategy:event ohlc <addr> Send test events
  8. npm run strategy:shutdown <addr>   Shutdown when done
`);

program.parse();
