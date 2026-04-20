# Blockchain MCP Server

Python [FastMCP](https://github.com/jlowin/fastmcp) server that wraps Foundry's
`cast` CLI and the Etherscan v2 API, exposing on-chain lookups to Claude Code.

It is project-scoped via the repo's [.mcp.json](../../.mcp.json) at the repo
root, so Claude Code auto-discovers it when started inside this workspace — no
per-user config needed.

## Prerequisites

- **Python 3.10+**
- **Foundry `cast` CLI** on `PATH`:
  ```bash
  curl -L https://foundry.paradigm.xyz | bash
  foundryup
  ```
- **Repo-root `.env`** populated with:
  - `ETHERSCAN_API_KEY` — a single v2 key works across all supported chains
  - `RPC_URL_ETHEREUM`, `RPC_URL_ARBITRUM`, `RPC_URL_BASE` — required for
    whichever chains you want to query
  - `RPC_URL_SEPOLIA`, `RPC_URL_LOCAL` — optional

The server loads `.env` via `python-dotenv` from the repo root — see
[server.py:14](server.py#L14).

## Install

```bash
pip install -r mcp/blockchain/requirements.txt
```

A virtualenv is fine; the only runtime deps are `fastmcp` and `python-dotenv`.

## Verify

```bash
claude mcp get blockchain    # expect: Status: ✓ Connected
claude mcp list              # blockchain should appear
```

If it fails to start, check in this order:

1. `cast --version` — Foundry on `PATH`
2. `.env` present at repo root with the vars above
3. Run the server directly to see the error:
   ```bash
   python3 mcp/blockchain/server.py
   ```
   (it runs on stdio; Ctrl-C to exit)

## Exposed tools

Defined as `@mcp.tool()` in [server.py](server.py):

- `get_transaction`, `get_receipt`, `get_block`
- `decode_calldata`, `decode_log`, `decode_logs_with_abi`
- `get_contract_abi`, `call_contract`, `get_logs`

Supported chains: `ethereum`, `arbitrum` (default), `base`, `sepolia`, `local`.

## Usage from Claude Code

Workflow guidance for Claude Code lives in
[.claude/rules/blockchain-analysis.md](../../.claude/rules/blockchain-analysis.md) —
it covers which tool to use for which question (transaction analysis, historical
events, contract state reads, etc.).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cast: command not found` | Install Foundry (see Prerequisites) |
| `ETHERSCAN_API_KEY not set in environment.` | `.env` missing or not at repo root |
| `No RPC URL found for chain 'X'.` | Set `RPC_URL_<CHAIN>` in `.env` |
| `Etherscan error: ...` | API key invalid, rate-limited, or contract not verified on that chain |
