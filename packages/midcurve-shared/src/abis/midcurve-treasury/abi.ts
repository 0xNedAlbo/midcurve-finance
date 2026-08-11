// ============================================================================
// GENERATED FILE — DO NOT EDIT
//
// Source:   apps/midcurve-contracts/contracts/treasury/MidcurveTreasury.sol
// Compiler: solc 0.8.28+commit.7893614a
// Regenerate: cd apps/midcurve-contracts && forge build && pnpm gen:treasury-artifacts
// ============================================================================

/**
 * MidcurveTreasury ABI.
 *
 * Used by the readiness check to read admin(), operator(), weth() and
 * swapRouter() off a candidate treasury before registering it.
 */
export const MIDCURVE_TREASURY_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "admin_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "operator_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "swapRouter_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "weth_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "admin",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "operator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "refuelOperator",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minEthOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hops",
        "type": "tuple[]",
        "internalType": "struct IMidcurveSwapRouter.Hop[]",
        "components": [
          {
            "name": "venueId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tokenIn",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "venueData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rescueEth",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setOperator",
    "inputs": [
      {
        "name": "newOperator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapRouter",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IMidcurveSwapRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sweep",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferAdmin",
    "inputs": [
      {
        "name": "newAdmin",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "weth",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AdminTransferred",
    "inputs": [
      {
        "name": "oldAdmin",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newAdmin",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EthRescued",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OperatorUpdated",
    "inputs": [
      {
        "name": "oldOperator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOperator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefuelOperator",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "ethOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Sweep",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAdmin",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAdminOrOperator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const;

export type MidcurveTreasuryAbi = typeof MIDCURVE_TREASURY_ABI;
