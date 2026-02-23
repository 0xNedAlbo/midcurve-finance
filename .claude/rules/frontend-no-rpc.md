# .claude/rules/frontend-no-rpc.md

---

## path: apps/midcurve-ui/\*\*

## Frontend: No Direct Blockchain Reads

All blockchain data (balances, approvals, tx status) comes from backend API endpoints.
Never use wagmi hooks or viem clients to read chain state in the frontend.

- ❌ useReadContract, useBalance, useTransactionReceipt, readContract
- ❌ useWaitForTransactionReceipt (unreliable — misses receipts, stale data)
- ❌ Any RPC*URL*\* env vars or publicClient/createPublicClient
- ✅ apiClient calls to backend endpoints that use our own RPC nodes

Wagmi is ONLY for wallet interactions that require the user's private key:

- Wallet connection (RainbowKit)
- SIWE message signing
- Transaction submission (sendTransaction / writeContract)
- ERC-20 approve calls

After submitting a transaction, poll the backend API for confirmation —
don't use wagmi to wait for the receipt.
If a needed backend endpoint doesn't exist yet, stop and tell the user —
don't work around it with a direct RPC call.
