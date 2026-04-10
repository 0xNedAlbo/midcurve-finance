// ============================================================================
// UniswapV3VaultPositionCloser V1.0 ABI (Interface Version 100)
// Generated from IUniswapV3VaultPositionCloserV1.sol
// Version: 1.0 (100 = majorVersion * 100 + minorVersion)
// ============================================================================

/**
 * ABI for UniswapV3VaultPositionCloser V1.0 (Diamond pattern)
 *
 * Interface features:
 * - Tick-based triggers (int24)
 * - TriggerMode: LOWER (0), UPPER (1)
 * - SwapDirection: NONE (0), TOKEN0_TO_1 (1), TOKEN1_TO_0 (2)
 * - OrderStatus: NONE (0), ACTIVE (1), EXECUTED (2), CANCELLED (3)
 * - Vault share-based positions (ERC-20 shares, not NFTs)
 */
export const UniswapV3VaultPositionCloserV100Abi = [
  {
    "type": "function",
    "name": "canExecuteOrder",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      }
    ],
    "outputs": [
      {
        "name": "canExecute",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelOrder",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeOrder",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "withdrawParams",
        "type": "tuple",
        "internalType": "struct IUniswapV3VaultPositionCloserV1.WithdrawParams",
        "components": [
          {
            "name": "amount0Min",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount1Min",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "swapParams",
        "type": "tuple",
        "internalType": "struct IUniswapV3VaultPositionCloserV1.SwapParams",
        "components": [
          {
            "name": "guaranteedAmountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minAmountOut",
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
        ]
      },
      {
        "name": "feeParams",
        "type": "tuple",
        "internalType": "struct IUniswapV3VaultPositionCloserV1.FeeParams",
        "components": [
          {
            "name": "feeRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feeBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getCurrentTick",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getOrder",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      }
    ],
    "outputs": [
      {
        "name": "order",
        "type": "tuple",
        "internalType": "struct VaultCloseOrder",
        "components": [
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum OrderStatus"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "pool",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "shares",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "triggerTick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "payout",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "validUntil",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "slippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "swapDirection",
            "type": "uint8",
            "internalType": "enum SwapDirection"
          },
          {
            "name": "swapSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasOrder",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      }
    ],
    "outputs": [
      {
        "name": "exists",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "interfaceVersion",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxFeeBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "multicall",
    "inputs": [
      {
        "name": "data",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [
      {
        "name": "results",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerOrder",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IUniswapV3VaultPositionCloserV1.RegisterOrderParams",
        "components": [
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "triggerMode",
            "type": "uint8",
            "internalType": "enum TriggerMode"
          },
          {
            "name": "shares",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "triggerTick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "payout",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "validUntil",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "slippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "swapDirection",
            "type": "uint8",
            "internalType": "enum SwapDirection"
          },
          {
            "name": "swapSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
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
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
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
    "name": "setPayout",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "newPayout",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setShares",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "newShares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSlippage",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "newSlippageBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSwapIntent",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "direction",
        "type": "uint8",
        "internalType": "enum SwapDirection"
      },
      {
        "name": "swapSlippageBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTriggerTick",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "newTriggerTick",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setValidUntil",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "internalType": "enum TriggerMode"
      },
      {
        "name": "newValidUntil",
        "type": "uint256",
        "internalType": "uint256"
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
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "version",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "event",
    "name": "FeeApplied",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "feeRecipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "feeBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "feeAmount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feeAmount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderCancelled",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderExecuted",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payout",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "executionTick",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "sharesClosed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount0Out",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1Out",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderOperatorUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldOperator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "newOperator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderPayoutUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldPayout",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "newPayout",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderRegistered",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "pool",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payout",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "triggerTick",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "shares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "validUntil",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "slippageBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "swapDirection",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum SwapDirection"
      },
      {
        "name": "swapSlippageBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderSharesUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderSlippageUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldSlippageBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "newSlippageBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderSwapIntentUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldDirection",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum SwapDirection"
      },
      {
        "name": "newDirection",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum SwapDirection"
      },
      {
        "name": "swapSlippageBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderTriggerTickUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldTick",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "newTick",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderValidUntilUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldValidUntil",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newValidUntil",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SwapExecuted",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "triggerMode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TriggerMode"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;
