# @midcurve/mcp-server

Model Context Protocol server for Midcurve Finance. Lets a Claude client (Claude
Desktop, Claude Code, etc.) query a user's portfolio over the existing midcurve
REST API in read-only mode.

## What it exposes

Sixteen tools, all read-only.

**Identity & portfolio**

| Tool | Purpose |
|------|---------|
| `get_user` | Identity check — returns the wallet address the API key is bound to. |
| `list_positions` | Paginated list of all positions with PnL/APR fields. |
| `get_position` | Detail of a single position (UniswapV3 NFT or vault). |
| `get_pnl` | Realized P&L statement for a period (day/week/month/quarter/year). |
| `list_close_orders` | Stop-loss / take-profit orders attached to a position. |
| `get_pool` | UniswapV3 pool state + subgraph metrics. |
| `list_notifications` | Range alerts and order-execution notifications. |

**Per-position deep-dive**

| Tool | Purpose |
|------|---------|
| `get_position_conversion` | Net deposits/withdrawals/holdings, net rebalancing direction + average execution price, fee premium, and per-segment rebalancing history. |
| `get_position_accounting` | Lifetime balance sheet, realized P&L breakdown, and full journal-entry audit trail (in the user's reporting currency). |
| `get_position_apr` | Per-period APR breakdown plus a time-weighted summary of realized, unrealized, and total APR. |

**Per-position simulation**

| Tool | Purpose |
|------|---------|
| `simulate_position_at_price` | Position value, PnL, base/quote amounts, and phase at a hypothetical price. |
| `generate_position_pnl_curve` | List of (price, value, pnl, pnlPercent, phase) points across a price range — defaults to ±50% around the current price. |

**Pure-math helpers**

These compose `@midcurve/shared` math directly. Each accepts the inputs explicitly OR a position-lookup (protocol/chainId/nftId or vault triple) that auto-fills them from a live position; explicit overrides win, so you can simulate "what if" hypotheticals.

| Tool | Purpose |
|------|---------|
| `compute_token_amounts_for_range` | Token0/token1 amounts a given liquidity holds in [tickLower, tickUpper] at sqrtPriceX96. |
| `simulate_swap_output` | Rough fair-value swap estimate (zero price impact — NOT for execution, see tool description). |
| `compute_liquidity_for_budget` | Maximum liquidity mintable from a base+quote budget given a tick range and current price. |
| `convert_price_and_tick` | Bidirectional price ↔ tick converter, with optional snap to a usable position-bound tick. |

## Setup

### 1. Build

From the monorepo root:

```bash
pnpm install
pnpm --filter @midcurve/mcp-server build
```

The build emits `apps/midcurve-mcp-server/dist/index.js` with a Node shebang.

### 2. Get an API key

In the midcurve UI, open the user dropdown → **API Keys** → **Create Key**. Give
it a name like "Claude Desktop" and copy the key — it starts with `mck_…` and
is shown only once.

### 3. Wire it into Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) — create the file if it doesn't exist:

```json
{
  "mcpServers": {
    "midcurve": {
      "command": "node",
      "args": [
        "/absolute/path/to/midcurve-finance/apps/midcurve-mcp-server/dist/index.js"
      ],
      "env": {
        "MIDCURVE_API_KEY": "mck_…paste your key here…",
        "MIDCURVE_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Replace the absolute path with your repo location. Set `MIDCURVE_API_URL` to the
production API URL once you're not running locally. Restart Claude Desktop.

### 4. Try it

In a new chat, ask things like:

- "Welche meiner midcurve-Positionen sind out of range?"
- "Wie viel habe ich diesen Monat realized PnL gemacht?"
- "Zeig mir alle Stop-Loss-Orders, die in der letzten Woche getriggert wurden."

Claude will pick the relevant tools, call them, and reason over the JSON
responses.

## Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `MIDCURVE_API_KEY` | yes | – | The `mck_…` key from the UI. |
| `MIDCURVE_API_URL` | no | `http://localhost:3001` | Base URL of the midcurve API. |
| `MIDCURVE_MCP_LOG_LEVEL` | no | `info` | Pino log level (`trace` `debug` `info` `warn` `error`). Logs go to stderr. |

## Local smoke test

You can drive the server directly with JSON-RPC over stdio without involving
Claude:

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}},"id":1}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_user","arguments":{}},"id":2}'; \
  sleep 1) \
| MIDCURVE_API_KEY=mck_… MIDCURVE_API_URL=http://localhost:3001 \
  node apps/midcurve-mcp-server/dist/index.js
```

You should see your own wallet address in the response.

## How auth works

- The server validates the key once at startup by calling `GET /api/v1/user/me`.
  If the key is missing, expired, or revoked the process exits with a clear
  error before the stdio transport opens — so the failure shows up in Claude's
  MCP server log, not as a vague tool-call failure.
- Subsequent tool calls send the same key as `Authorization: Bearer mck_…`. If
  the key is revoked while the server is running, the next tool call fails
  with HTTP 401 and a tool-error response is returned to Claude.
- The key never appears in tool inputs or outputs — only in environment
  variables and outbound HTTP headers.

## Limits / not in scope

- **Read-only.** No tools to create or cancel orders. Wallet signatures aren't
  possible from a server process anyway.
- **Local only (stdio).** No SSE/HTTP transport. Each user runs their own
  server locally.
- Bigint amounts on positions are returned as raw decimal strings without
  human formatting (the API doesn't include the quote-token decimals on the
  list endpoint). Use `get_position` for human-readable values.
