"""
Blockchain MCP Server
Wraps Foundry's `cast` CLI + Etherscan v2 API for Claude Code.
"""

import json
import os
import subprocess
import urllib.request
import urllib.parse
from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

mcp = FastMCP("blockchain")

# --- Chain config -----------------------------------------------------------

CHAINS = {
    "ethereum": {"env": "RPC_URL_ETHEREUM", "chain_id": 1},
    "mainnet":  {"env": "RPC_URL_ETHEREUM", "chain_id": 1},
    "arbitrum": {"env": "RPC_URL_ARBITRUM", "chain_id": 42161},
    "base":     {"env": "RPC_URL_BASE",     "chain_id": 8453},
    "sepolia":  {"env": "RPC_URL_SEPOLIA",  "chain_id": 11155111},
    "local":    {"env": "RPC_URL_LOCAL",     "chain_id": None},
}

# --- Helpers ----------------------------------------------------------------

def rpc_url(chain: str = "arbitrum") -> str:
    """Resolve the RPC URL for a given chain from env vars."""
    cfg = CHAINS.get(chain.lower())
    if not cfg:
        raise ValueError(
            f"Unknown chain '{chain}'. "
            f"Supported: {', '.join(CHAINS.keys())}"
        )
    url = os.environ.get(cfg["env"])
    if not url:
        raise ValueError(
            f"No RPC URL found for chain '{chain}'. "
            f"Set {cfg['env']} in your .env file."
        )
    return url


def run_cast(*args: str) -> str:
    """Run a cast command and return stdout, raising on error."""
    cmd = ["cast", *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"cast error: {result.stderr.strip()}")
    return result.stdout.strip()


def etherscan_get(params: dict, chain: str = "arbitrum") -> dict:
    """Make a request to the Etherscan v2 API (single endpoint, chainid param)."""
    api_key = os.environ.get("ETHERSCAN_API_KEY")
    if not api_key:
        raise ValueError("ETHERSCAN_API_KEY not set in environment.")

    cfg = CHAINS.get(chain.lower())
    if not cfg or cfg["chain_id"] is None:
        raise ValueError(f"Etherscan not available for chain '{chain}'.")

    base_url = "https://api.etherscan.io/v2/api"
    params["apikey"] = api_key
    params["chainid"] = cfg["chain_id"]
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url) as resp:
        data = json.loads(resp.read())
    if data.get("status") == "0" and data.get("message") != "No transactions found":
        raise RuntimeError(f"Etherscan error: {data.get('result')}")
    return data


# --- Tools ------------------------------------------------------------------

@mcp.tool()
def get_transaction(tx_hash: str, chain: str = "arbitrum") -> str:
    """
    Fetch full transaction details: sender, receiver, value, calldata, gas.
    Use this as the first step when analyzing any transaction.
    """
    return run_cast("tx", tx_hash, "--rpc-url", rpc_url(chain))


@mcp.tool()
def get_receipt(tx_hash: str, chain: str = "arbitrum") -> str:
    """
    Fetch the transaction receipt: status (success/fail), gas used, and raw logs.
    Raw logs include topics and data but are not ABI-decoded yet.
    Use decode_log or decode_logs_with_abi for human-readable events.
    """
    return run_cast("receipt", tx_hash, "--rpc-url", rpc_url(chain))


@mcp.tool()
def decode_calldata(calldata: str) -> str:
    """
    Decode function calldata using 4byte.directory signatures.
    Input: the 'input' field from get_transaction (hex string starting with 0x).
    Returns the function name and decoded arguments.
    """
    return run_cast("4byte-decode", calldata)


@mcp.tool()
def decode_log(
    event_signature: str,
    topics: str,
    data: str,
) -> str:
    """
    Decode a single raw log entry using a known event signature.

    Args:
        event_signature: e.g. "Transfer(address,address,uint256)"
        topics: comma-separated topic hex strings from the log
        data: the 'data' field from the log (hex string)
    """
    return run_cast("decode-log", event_signature, topics, data)


@mcp.tool()
def get_contract_abi(address: str, chain: str = "arbitrum") -> str:
    """
    Fetch the verified ABI of a contract from Etherscan.
    Returns the ABI as a JSON string.
    """
    data = etherscan_get({
        "module": "contract",
        "action": "getabi",
        "address": address,
    }, chain=chain)
    abi = json.loads(data["result"])
    return json.dumps(abi, indent=2)


@mcp.tool()
def decode_logs_with_abi(tx_hash: str, contract_address: str, chain: str = "arbitrum") -> str:
    """
    Full pipeline: fetch receipt logs + ABI, then decode all events.
    This is the most useful tool for understanding what happened in a transaction.

    Args:
        tx_hash: the transaction hash
        contract_address: the contract whose ABI to use for decoding
        chain: ethereum | arbitrum | base | sepolia
    """
    abi_data = etherscan_get({
        "module": "contract",
        "action": "getabi",
        "address": contract_address,
    }, chain=chain)
    abi = json.loads(abi_data["result"])

    event_sigs = {}
    for item in abi:
        if item.get("type") != "event":
            continue
        inputs = ",".join(i["type"] for i in item.get("inputs", []))
        sig = f"{item['name']}({inputs})"
        topic0 = run_cast("keccak", sig)
        event_sigs[topic0.lower()] = sig

    receipt_raw = run_cast("receipt", tx_hash, "--json", "--rpc-url", rpc_url(chain))
    receipt = json.loads(receipt_raw)

    results = []
    logs = receipt.get("logs", [])

    if not logs:
        return "No logs found in this transaction."

    for i, log in enumerate(logs):
        topics = log.get("topics", [])
        data = log.get("data", "0x")
        address = log.get("address", "")

        entry: dict = {
            "log_index": i,
            "contract": address,
            "raw_topics": topics,
        }

        if topics:
            topic0 = topics[0].lower()
            sig = event_sigs.get(topic0)
            if sig:
                topics_arg = ",".join(topics)
                decoded = run_cast("decode-log", sig, topics_arg, data)
                entry["event"] = sig
                entry["decoded"] = decoded
            else:
                try:
                    sig_lookup = run_cast("4byte-event", topics[0])
                    entry["event_signature_guess"] = sig_lookup
                    entry["note"] = "Not in provided ABI, signature guessed via 4byte"
                except Exception:
                    entry["note"] = "Unknown event (not in ABI, no 4byte match)"

        results.append(entry)

    return json.dumps(results, indent=2)


@mcp.tool()
def get_block(block: str, chain: str = "arbitrum") -> str:
    """
    Fetch block details by number or hash.
    Use 'latest' for the most recent block.
    """
    return run_cast("block", block, "--rpc-url", rpc_url(chain))


@mcp.tool()
def call_contract(
    contract_address: str,
    function_signature: str,
    args: str = "",
    chain: str = "arbitrum",
    block: str = "latest",
) -> str:
    """
    Call a read-only contract function (eth_call).

    Args:
        contract_address: target contract
        function_signature: e.g. "balanceOf(address)(uint256)"
                            Note: cast requires return types appended in parens
        args: space-separated arguments, e.g. "0xAbC123..."
        block: block number or 'latest'
        chain: ethereum | arbitrum | base | sepolia
    """
    cmd_args = ["call", contract_address, function_signature]
    if args:
        cmd_args.extend(args.split())
    cmd_args.extend(["--block", block, "--rpc-url", rpc_url(chain)])
    return run_cast(*cmd_args)


@mcp.tool()
def get_logs(
    contract_address: str,
    event_signature: str,
    from_block: str,
    to_block: str = "latest",
    chain: str = "arbitrum",
) -> str:
    """
    Fetch historical logs for a specific event from a contract.

    Args:
        contract_address: the emitting contract
        event_signature: e.g. "Transfer(address,address,uint256)"
        from_block: start block number (e.g. "19000000")
        to_block: end block number or "latest"
        chain: ethereum | arbitrum | base | sepolia
    """
    return run_cast(
        "logs",
        "--from-block", from_block,
        "--to-block", to_block,
        "--address", contract_address,
        "--rpc-url", rpc_url(chain),
        event_signature,
    )


# --- Entry point ------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
