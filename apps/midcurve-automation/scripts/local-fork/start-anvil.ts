/**
 * Start Anvil Fork
 *
 * Launches an Anvil instance forking from Ethereum mainnet.
 * Requires: anvil (from foundry) and RPC_URL_ETHEREUM env var.
 *
 * Port: 8547 (to avoid conflict with midcurve-evm Geth on 8545-8546)
 * Chain ID: 31337
 */

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env file manually (no dotenv dependency)
function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Only set if not already in environment
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const ANVIL_PORT = 8547;
const CHAIN_ID = 31337;

async function main(): Promise<void> {
    const rpcUrl = process.env.RPC_URL_ETHEREUM;

    if (!rpcUrl) {
        console.error(
            "ERROR: RPC_URL_ETHEREUM environment variable is required"
        );
        console.error("");
        console.error("Usage:");
        console.error(
            '  export RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"'
        );
        console.error("  pnpm local:anvil");
        process.exit(1);
    }

    console.log("=".repeat(60));
    console.log("Starting Anvil Fork");
    console.log("=".repeat(60));
    console.log("Fork URL:", rpcUrl.substring(0, 50) + "...");
    console.log("Local Port:", ANVIL_PORT);
    console.log("Chain ID:", CHAIN_ID);
    console.log("Block Time: 3 second");
    console.log("Pre-funded Balance: 10,000 ETH per account");
    console.log("");
    console.log("Foundry test account #0:");
    console.log("  Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    console.log(
        "  Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    );
    console.log("");
    console.log("RPC Endpoint: http://localhost:" + ANVIL_PORT);
    console.log("=".repeat(60));
    console.log("");

    const anvil = spawn(
        "anvil",
        [
            "--fork-url",
            rpcUrl,
            "--port",
            ANVIL_PORT.toString(),
            "--chain-id",
            CHAIN_ID.toString(),
            "--block-time",
            "3", // 1 second blocks for testing
            "--balance",
            "10000", // Pre-fund accounts with 10000 ETH
        ],
        {
            stdio: "inherit",
        }
    );

    anvil.on("error", (err) => {
        console.error("");
        console.error("Failed to start Anvil:", err.message);
        console.error("");
        console.error("Make sure Foundry is installed:");
        console.error("  curl -L https://foundry.paradigm.xyz | bash");
        console.error("  foundryup");
        process.exit(1);
    });

    anvil.on("close", (code) => {
        console.log("");
        console.log("Anvil exited with code:", code);
        process.exit(code ?? 0);
    });

    // Handle shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down Anvil...");
        anvil.kill("SIGINT");
    });

    process.on("SIGTERM", () => {
        console.log("\nShutting down Anvil...");
        anvil.kill("SIGTERM");
    });
}

main().catch(console.error);
