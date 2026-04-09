# Blockchain Analysis

When analyzing transactions, contracts, or onchain events, always use the `blockchain` MCP server. Never write raw RPC calls or fetch Etherscan directly in code when the MCP tools can answer the question.

## Chains

Default to `arbitrum` unless the context clearly indicates otherwise.
Available chains: `ethereum`, `arbitrum`, `base`, `sepolia`.

## Workflow

**Transaction analysis:**
1. `get_transaction` — Sender, Receiver, Value, Calldata
2. `decode_calldata` — Which function was called?
3. `decode_logs_with_abi` with the contract address — All events decoded

**Decode a single event:**
→ `decode_log` with a known signature, or `get_receipt` for raw logs

**Historical events from a contract:**
→ `get_logs` with event signature and block range

**Read contract state:**
→ `call_contract` with function signature including return type, e.g. `"slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)"`

## Known Contracts (Arbitrum)

- Uniswap V3 Factory: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- Uniswap V3 Router: `0xE592427A0AEce92De3Edee1F18E0157C05861564`
- Uniswap V3 Quoter V2: `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`

Add Midcurve-specific contract addresses here as the project grows.
