/**
 * Midcurve MCP Server
 *
 * Read-only MCP server that exposes the user's midcurve portfolio (positions,
 * PnL, close orders, pools, notifications) to Claude. Authenticates against
 * the midcurve REST API with a long-lived API key.
 *
 * Transport: stdio (Claude Desktop / Claude Code launch this binary as a
 * subprocess and speak JSON-RPC over stdin/stdout). Logs go to stderr to
 * keep stdout clean for the protocol.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pino from 'pino';
import { ApiClient, ApiError } from './api-client.js';
import { loadEnv } from './env.js';
import { buildGetUserTool } from './tools/get-user.js';
import { buildListPositionsTool } from './tools/list-positions.js';
import { buildGetPositionTool } from './tools/get-position.js';
import { buildGetPnlTool } from './tools/get-pnl.js';
import { buildListCloseOrdersTool } from './tools/list-close-orders.js';
import { buildGetPoolTool } from './tools/get-pool.js';
import { buildListNotificationsTool } from './tools/list-notifications.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino(
    { level: env.logLevel, base: { service: 'midcurve-mcp' } },
    pino.destination(2)
  );

  log.info({ apiUrl: env.apiUrl }, 'starting midcurve mcp server');

  const client = new ApiClient({ baseUrl: env.apiUrl, apiKey: env.apiKey });

  // Verify the key works before attaching the transport. Failing here surfaces
  // a clear error in the Claude Desktop logs instead of a vague tool-call failure later.
  try {
    const me = await client.get<{ address: string }>('/api/v1/user/me');
    log.info({ address: me.address }, 'api key validated');
  } catch (err) {
    if (err instanceof ApiError) {
      log.error(
        { status: err.statusCode, code: err.code, message: err.message },
        'api key validation failed — server will not start'
      );
    } else {
      log.error({ err }, 'unexpected error during api key validation');
    }
    throw err;
  }

  const server = new McpServer({ name: 'midcurve', version: '0.1.0' });

  function register<T extends { name: string; config: unknown; handler: (args: never) => Promise<unknown> }>(
    tool: T
  ): void {
    const wrapped = async (args: unknown): Promise<unknown> => {
      try {
        return await tool.handler(args as never);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `${err.message} (HTTP ${err.statusCode}${err.code ? `, ${err.code}` : ''})`
            : err instanceof Error
              ? err.message
              : String(err);
        log.warn({ tool: tool.name, message }, 'tool call failed');
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.registerTool(tool.name, tool.config as any, wrapped as any);
  }

  register(buildGetUserTool(client));
  register(buildListPositionsTool(client));
  register(buildGetPositionTool(client));
  register(buildGetPnlTool(client));
  register(buildListCloseOrdersTool(client));
  register(buildGetPoolTool(client));
  register(buildListNotificationsTool(client));

  log.info({ count: 7 }, 'tools registered');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('mcp server connected to stdio transport, ready for requests');
}

main().catch((err) => {
  // Last-resort error logger — pino isn't initialized if loadEnv() throws.
  process.stderr.write(
    `[midcurve-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
