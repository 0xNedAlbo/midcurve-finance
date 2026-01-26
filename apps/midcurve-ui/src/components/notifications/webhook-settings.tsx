/**
 * Webhook Settings Component
 *
 * Multi-state component for webhook configuration:
 * - Empty: No webhook configured
 * - Create: Form to create new webhook
 * - View: Display configured webhook with enable toggle
 * - Edit: Form to edit existing webhook
 */

import { useState, useEffect } from 'react';
import {
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Globe,
  Key,
  RefreshCw,
  Copy,
  Pencil,
  Plus,
  Bell,
  BellOff,
  Book,
  ArrowLeft,
} from 'lucide-react';
import {
  useWebhookConfig,
  useUpdateWebhookConfig,
  useTestWebhook,
} from '@/hooks/notifications';
import type { NotificationEventType, UpdateWebhookConfigBody } from '@midcurve/api-shared';

// =============================================================================
// CONSTANTS
// =============================================================================

const EVENT_TYPES: { value: NotificationEventType; label: string; description: string }[] = [
  {
    value: 'POSITION_OUT_OF_RANGE',
    label: 'Position Out of Range',
    description: 'When a position moves outside its liquidity range',
  },
  {
    value: 'POSITION_IN_RANGE',
    label: 'Position In Range',
    description: 'When a position returns to its liquidity range',
  },
  {
    value: 'STOP_LOSS_EXECUTED',
    label: 'Stop Loss Executed',
    description: 'When a stop loss order is successfully executed',
  },
  {
    value: 'STOP_LOSS_FAILED',
    label: 'Stop Loss Failed',
    description: 'When a stop loss order fails to execute',
  },
  {
    value: 'TAKE_PROFIT_EXECUTED',
    label: 'Take Profit Executed',
    description: 'When a take profit order is successfully executed',
  },
  {
    value: 'TAKE_PROFIT_FAILED',
    label: 'Take Profit Failed',
    description: 'When a take profit order fails to execute',
  },
];

/**
 * Documentation data for each event type with example payloads
 */
/**
 * Example position data for webhook payload documentation
 * Represents ListPositionData with BigIntToString transformation
 */
const EXAMPLE_POSITION_DATA = {
  id: 'pos_12345',
  createdAt: '2024-01-10T08:00:00.000Z',
  updatedAt: '2024-01-15T10:30:00.000Z',
  positionHash: 'uniswapv3/1/123456',
  protocol: 'uniswapv3',
  positionType: 'CL_TICKS',
  userId: 'user_abc123',
  currentValue: '15030440000',
  currentCostBasis: '10000000000',
  realizedPnl: '0',
  unrealizedPnl: '5030440000',
  realizedCashflow: '0',
  unrealizedCashflow: '0',
  collectedFees: '500000000',
  unClaimedFees: '150000000',
  lastFeesCollectedAt: '2024-01-14T12:00:00.000Z',
  totalApr: 45.23,
  priceRangeLower: '2600450000',
  priceRangeUpper: '3000450000',
  isToken0Quote: true,
  positionOpenedAt: '2024-01-10T08:00:00.000Z',
  positionClosedAt: null,
  isActive: true,
  pool: {
    id: 'pool_xyz789',
    protocol: 'uniswapv3',
    token0: {
      id: 'token_usdc',
      tokenType: 'evm-erc20',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      config: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1 },
    },
    token1: {
      id: 'token_weth',
      tokenType: 'evm-erc20',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      config: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chainId: 1 },
    },
    config: {
      chainId: 1,
      poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
      feeTier: 3000,
      tickSpacing: 60,
    },
    state: {
      sqrtPriceX96: '1234567890123456789012345678',
      liquidity: '12345678901234567890',
      currentTick: -201234,
    },
  },
  config: {
    chainId: 1,
    nftId: '123456',
    poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
    tickLower: -202000,
    tickUpper: -200000,
  },
  state: {
    ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
    liquidity: '9876543210987654321',
    feeGrowthInside0LastX128: '12345678901234567890',
    feeGrowthInside1LastX128: '98765432109876543210',
    tokensOwed0: '500000',
    tokensOwed1: '100000000000000000',
  },
};

/**
 * Example close order data for SL/TP webhook payload documentation
 * Represents SerializedCloseOrder with full config and state
 */
const EXAMPLE_CLOSE_ORDER_DATA = {
  id: 'clord_abc123def456',
  closeOrderType: 'uniswapv3',
  status: 'executed',
  positionId: 'pos_12345',
  automationContractConfig: {
    chainId: 1,
    contractAddress: '0xAutomation1234567890abcdef1234567890abcdef',
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  },
  config: {
    closeId: 42,
    nftId: '123456',
    poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
    triggerMode: 'LOWER',
    sqrtPriceX96Lower: '1234567890123456789012345678',
    sqrtPriceX96Upper: '9876543210987654321098765432',
    payoutAddress: '0x1234567890abcdef1234567890abcdef12345678',
    operatorAddress: '0xOperator1234567890abcdef1234567890abcdef',
    validUntil: '2024-02-15T00:00:00.000Z',
    slippageBps: 50,
    swapConfig: {
      enabled: true,
      direction: 'TOKEN0_TO_1',
      slippageBps: 100,
    },
  },
  state: {
    registrationTxHash: '0xreg1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    registeredAt: '2024-01-10T09:00:00.000Z',
    triggeredAt: '2024-01-15T12:00:00.000Z',
    triggerSqrtPriceX96: '1234567890123456789012345678',
    executionTxHash: '0xexec1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    executedAt: '2024-01-15T12:00:30.000Z',
    executionFeeBps: 10,
    executionError: null,
    retryCount: 0,
    amount0Out: '15030440000',
    amount1Out: '0',
    swapExecution: {
      swapExecuted: true,
      swapDirection: 'TOKEN0_TO_1',
      srcToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      destToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      srcAmount: '5000000000000000000',
      destAmount: '15030440000',
      minDestAmount: '14880000000',
      augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
      swapSlippageBps: 100,
    },
  },
  createdAt: '2024-01-10T08:00:00.000Z',
  updatedAt: '2024-01-15T12:00:30.000Z',
};

const EVENT_DOCS: Record<
  NotificationEventType,
  {
    label: string;
    description: string;
    examplePayload: object;
  }
> = {
  POSITION_OUT_OF_RANGE: {
    label: 'Position Out of Range',
    description: 'Sent when a position moves outside its configured price range.',
    examplePayload: {
      eventId: 'evt_abc123def456',
      eventType: 'POSITION_OUT_OF_RANGE',
      timestamp: '2024-01-15T10:30:00.000Z',
      title: 'Position Out of Range',
      message: 'Your ETH/USDC position #12345 is now out of range',
      positionId: 'pos_12345',
      quoteCurrency: 'USDC',
      baseCurrency: 'WETH',
      priceUpper: '3,000.45',
      priceLower: '2,600.45',
      currentPrice: '3,100.45',
      currentPnl: '5,680.44',
      position: EXAMPLE_POSITION_DATA,
    },
  },
  POSITION_IN_RANGE: {
    label: 'Position In Range',
    description: 'Sent when a position returns within its configured price range.',
    examplePayload: {
      eventId: 'evt_def456abc789',
      eventType: 'POSITION_IN_RANGE',
      timestamp: '2024-01-15T11:45:00.000Z',
      title: 'Position In Range',
      message: 'Your ETH/USDC position #12345 is back in range',
      positionId: 'pos_12345',
      quoteCurrency: 'USDC',
      baseCurrency: 'WETH',
      priceUpper: '3,000.45',
      priceLower: '2,600.45',
      currentPrice: '2,850.00',
      currentPnl: '5,680.44',
      position: EXAMPLE_POSITION_DATA,
    },
  },
  STOP_LOSS_EXECUTED: {
    label: 'Stop Loss Executed',
    description: 'Sent when a stop loss order is successfully executed.',
    examplePayload: {
      eventId: 'evt_stop123exec',
      eventType: 'STOP_LOSS_EXECUTED',
      timestamp: '2024-01-15T12:00:00.000Z',
      title: 'Stop Loss Executed',
      message: 'Stop loss executed for your ETH/USDC position #12345',
      positionId: 'pos_12345',
      quoteCurrency: 'USDC',
      baseCurrency: 'WETH',
      triggerPrice: '2,600.45',
      executionPrice: '2,598.20',
      amountOut: '15,030.44',
      currentPnl: '5,680.44',
      txHash: '0x1234...abcdef',
      position: EXAMPLE_POSITION_DATA,
      closeOrder: {
        ...EXAMPLE_CLOSE_ORDER_DATA,
        config: {
          ...EXAMPLE_CLOSE_ORDER_DATA.config,
          triggerMode: 'LOWER',
        },
      },
    },
  },
  STOP_LOSS_FAILED: {
    label: 'Stop Loss Failed',
    description: 'Sent when a stop loss order fails to execute.',
    examplePayload: {
      eventId: 'evt_stop456fail',
      eventType: 'STOP_LOSS_FAILED',
      timestamp: '2024-01-15T12:05:00.000Z',
      title: 'Stop Loss Failed',
      message: 'Stop loss failed for your ETH/USDC position #12345',
      positionId: 'pos_12345',
      quoteCurrency: 'USDC',
      baseCurrency: 'WETH',
      triggerPrice: '2,600.45',
      error: 'Slippage tolerance exceeded',
      retryCount: 3,
      position: EXAMPLE_POSITION_DATA,
      closeOrder: {
        ...EXAMPLE_CLOSE_ORDER_DATA,
        status: 'failed',
        config: {
          ...EXAMPLE_CLOSE_ORDER_DATA.config,
          triggerMode: 'LOWER',
        },
        state: {
          ...EXAMPLE_CLOSE_ORDER_DATA.state,
          executionTxHash: null,
          executedAt: null,
          executionError: 'Slippage tolerance exceeded',
          retryCount: 3,
          amount0Out: null,
          amount1Out: null,
          swapExecution: undefined,
        },
      },
    },
  },
  TAKE_PROFIT_EXECUTED: {
    label: 'Take Profit Executed',
    description: 'Sent when a take profit order is successfully executed.',
    examplePayload: {
      eventId: 'evt_tp789exec',
      eventType: 'TAKE_PROFIT_EXECUTED',
      timestamp: '2024-01-15T14:30:00.000Z',
      title: 'Take Profit Executed',
      message: 'Take profit executed for your ETH/USDC position #12345',
      positionId: 'pos_12345',
      quoteCurrency: 'USDC',
      baseCurrency: 'WETH',
      triggerPrice: '3,000.45',
      executionPrice: '3,002.10',
      amountOut: '18,250.00',
      currentPnl: '8,250.00',
      txHash: '0xabcdef...123456',
      position: EXAMPLE_POSITION_DATA,
      closeOrder: {
        ...EXAMPLE_CLOSE_ORDER_DATA,
        config: {
          ...EXAMPLE_CLOSE_ORDER_DATA.config,
          triggerMode: 'UPPER',
        },
      },
    },
  },
  TAKE_PROFIT_FAILED: {
    label: 'Take Profit Failed',
    description: 'Sent when a take profit order fails to execute.',
    examplePayload: {
      eventId: 'evt_tp012fail',
      eventType: 'TAKE_PROFIT_FAILED',
      timestamp: '2024-01-15T14:35:00.000Z',
      title: 'Take Profit Failed',
      message: 'Take profit failed for your ETH/USDC position #12345',
      positionId: 'pos_12345',
      quoteCurrency: 'USDC',
      baseCurrency: 'WETH',
      triggerPrice: '3,000.45',
      error: 'Insufficient gas',
      retryCount: 2,
      position: EXAMPLE_POSITION_DATA,
      closeOrder: {
        ...EXAMPLE_CLOSE_ORDER_DATA,
        status: 'failed',
        config: {
          ...EXAMPLE_CLOSE_ORDER_DATA.config,
          triggerMode: 'UPPER',
        },
        state: {
          ...EXAMPLE_CLOSE_ORDER_DATA.state,
          executionTxHash: null,
          executedAt: null,
          executionError: 'Insufficient gas',
          retryCount: 2,
          amount0Out: null,
          amount1Out: null,
          swapExecution: undefined,
        },
      },
    },
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a cryptographically secure random hex string (32 characters / 128 bits)
 */
const generateSecret = () => {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Get human-readable label for an event type
 */
const getEventLabel = (eventType: NotificationEventType): string => {
  return EVENT_TYPES.find((e) => e.value === eventType)?.label || eventType;
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

type ViewMode = 'empty' | 'create' | 'view' | 'edit' | 'docs';

/**
 * Empty State - No webhook configured
 */
function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-8">
      <div className="flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-slate-700/50 flex items-center justify-center mb-4">
          <Globe className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-base font-medium text-slate-100 mb-2">No Webhook Configured</h3>
        <p className="text-sm text-slate-400 mb-6 max-w-sm">
          Set up a webhook to receive HTTP POST notifications when events occur on your positions.
        </p>
        <button
          onClick={onCreateClick}
          className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Webhook
        </button>
      </div>
    </div>
  );
}

/**
 * Webhook Form - Create or Edit mode
 */
function WebhookForm({
  mode,
  webhookUrl,
  webhookSecret,
  hasExistingSecret,
  enabledEvents,
  onUrlChange,
  onGenerateSecret,
  onCopySecret,
  onEventToggle,
  onSelectAll,
  onDeselectAll,
  onSave,
  onCancel,
  isSaving,
  hasChanges,
}: {
  mode: 'create' | 'edit';
  webhookUrl: string;
  webhookSecret: string;
  hasExistingSecret: boolean;
  enabledEvents: NotificationEventType[];
  onUrlChange: (url: string) => void;
  onGenerateSecret: () => void;
  onCopySecret: () => void;
  onEventToggle: (eventType: NotificationEventType) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  hasChanges: boolean;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 divide-y divide-slate-700/50">
      {/* Header */}
      <div className="p-6">
        <h3 className="text-base font-medium text-slate-100">
          {mode === 'create' ? 'Create Webhook' : 'Edit Webhook'}
        </h3>
        <p className="text-sm text-slate-400 mt-1">
          Configure your webhook endpoint and notification preferences
        </p>
      </div>

      {/* Webhook URL */}
      <div className="p-6">
        <label className="block">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-200">Webhook URL</span>
          </div>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://your-server.com/webhook"
            className={`w-full px-3 py-2 bg-slate-900/50 border rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 ${
              webhookUrl && !webhookUrl.startsWith('https://')
                ? 'border-red-500/50'
                : 'border-slate-700'
            }`}
          />
          {webhookUrl && !webhookUrl.startsWith('https://') ? (
            <p className="text-xs text-red-400 mt-1.5">
              Webhook URL must start with https://
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-1.5">
              Notifications will be sent as POST requests to this URL
            </p>
          )}
        </label>
      </div>

      {/* Webhook Secret */}
      <div className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Key className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-200">Webhook Secret</span>
          <span className="text-xs text-slate-500">(required)</span>
        </div>

        {webhookSecret ? (
          /* Show generated secret with copy button */
          <div className="flex items-center gap-2 p-3 bg-slate-900/50 border border-slate-700 rounded-lg">
            <code className="flex-1 text-sm font-mono text-slate-200 break-all">
              {webhookSecret}
            </code>
            <button
              type="button"
              onClick={onCopySecret}
              className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Copy to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onGenerateSecret}
              className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Generate new secret"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        ) : hasExistingSecret ? (
          /* Secret exists on server but not shown */
          <div className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700 rounded-lg">
            <span className="text-sm text-slate-400">Keep existing secret</span>
            <button
              type="button"
              onClick={onGenerateSecret}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Generate New
            </button>
          </div>
        ) : (
          /* No secret configured - show error state */
          <div className="flex items-center justify-between p-3 bg-slate-900/50 border border-red-500/50 rounded-lg">
            <span className="text-sm text-red-400">Secret required</span>
            <button
              type="button"
              onClick={onGenerateSecret}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Generate
            </button>
          </div>
        )}

        {!webhookSecret && !hasExistingSecret ? (
          <p className="text-xs text-red-400 mt-1.5">
            A webhook secret is required for secure delivery
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-1.5">
            Sent as X-Webhook-Secret header for verification
          </p>
        )}
      </div>

      {/* Event Types */}
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-slate-200">Event Types</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={onSelectAll}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
            >
              Select all
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={onDeselectAll}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
            >
              Deselect all
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {EVENT_TYPES.map((event) => (
            <label
              key={event.value}
              className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg hover:bg-slate-900/50 transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={enabledEvents.includes(event.value)}
                onChange={() => onEventToggle(event.value)}
                className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
              />
              <div>
                <p className="text-sm font-medium text-slate-200">{event.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{event.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Cancel Button */}
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>

          </div>

          {/* Save Button */}
          <button
            onClick={onSave}
            disabled={
              !webhookUrl ||
              !webhookUrl.startsWith('https://') ||
              (!webhookSecret && !hasExistingSecret) ||
              !hasChanges ||
              isSaving
            }
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {mode === 'create' ? 'Create Webhook' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Webhook View - Display configured webhook
 */
function WebhookView({
  url,
  hasSecret,
  enabledEvents,
  isActive,
  isToggling,
  lastDelivery,
  onEditClick,
  onToggleActive,
  onDocsClick,
}: {
  url: string;
  hasSecret: boolean;
  enabledEvents: NotificationEventType[];
  isActive: boolean;
  isToggling: boolean;
  lastDelivery: {
    at: string;
    status: 'success' | 'failed' | null;
    error: string | null;
  } | null;
  onEditClick: () => void;
  onToggleActive: () => void;
  onDocsClick: () => void;
}) {
  const enabledLabels = enabledEvents.map(getEventLabel);
  const disabledEvents = EVENT_TYPES.filter((e) => !enabledEvents.includes(e.value));
  const disabledLabels = disabledEvents.map((e) => e.label);

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 divide-y divide-slate-700/50">
      {/* Header with Enable Toggle */}
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isActive ? 'bg-blue-500/20' : 'bg-slate-700/50'
              }`}
            >
              {isActive ? (
                <Bell className="w-5 h-5 text-blue-400" />
              ) : (
                <BellOff className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div>
              <h3 className="text-base font-medium text-slate-100">Webhook Notifications</h3>
              <p className="text-sm text-slate-400">
                {isActive ? 'Webhook is active' : 'Webhook is disabled'}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={onToggleActive}
              disabled={isToggling}
              className="sr-only peer"
            />
            <div
              className={`w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500 ${
                isToggling ? 'opacity-50' : ''
              }`}
            ></div>
          </label>
        </div>
      </div>

      {/* Webhook Details */}
      <div className="p-6 space-y-4">
        {/* URL */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">URL</span>
          </div>
          <p className="text-sm text-slate-200 font-mono break-all">{url}</p>
        </div>

        {/* Secret */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Secret
            </span>
          </div>
          <p className="text-sm text-slate-200 font-mono">
            {hasSecret ? '••••••••••••••••' : 'Not configured'}
          </p>
        </div>

        {/* Enabled Events */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Notifications
            </span>
          </div>
          {enabledLabels.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm text-slate-200">
                <span className="text-green-400">Enabled:</span> {enabledLabels.join(', ')}
              </p>
              {disabledLabels.length > 0 && (
                <p className="text-sm text-slate-400">
                  <span className="text-slate-500">Disabled:</span> {disabledLabels.join(', ')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No event types enabled</p>
          )}
        </div>

        {/* Last Delivery Status */}
        {lastDelivery && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Send className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Last Delivery
              </span>
            </div>
            <div className="flex items-center gap-2">
              {lastDelivery.status === 'success' ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : lastDelivery.status === 'failed' ? (
                <XCircle className="w-4 h-4 text-red-400" />
              ) : null}
              <p className="text-sm text-slate-200">
                {lastDelivery.status === 'success'
                  ? 'Delivered successfully'
                  : lastDelivery.status === 'failed'
                    ? lastDelivery.error || 'Delivery failed'
                    : 'Unknown status'}
              </p>
              <span className="text-xs text-slate-500">
                {new Date(lastDelivery.at).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onEditClick}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <Pencil className="w-4 h-4" />
            Edit Webhook
          </button>
          <button
            onClick={onDocsClick}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <Book className="w-4 h-4" />
            Documentation
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Webhook Documentation - Interactive API documentation
 */
function WebhookDocs({
  webhookUrl,
  onBack,
  onTest,
  isTesting,
  testResult,
}: {
  webhookUrl: string;
  onBack: () => void;
  onTest: (eventType: NotificationEventType) => void;
  isTesting: boolean;
  testResult: { success: boolean; message: string } | null;
}) {
  const [selectedEvent, setSelectedEvent] = useState<NotificationEventType>('POSITION_OUT_OF_RANGE');
  const selectedEventDoc = EVENT_DOCS[selectedEvent];

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 divide-y divide-slate-700/50">
      {/* Header with back button */}
      <div className="p-6">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Webhook
          </button>
          <div className="flex items-center gap-2 text-slate-400">
            <Book className="w-4 h-4" />
            <span className="text-sm font-medium">Documentation</span>
          </div>
        </div>
      </div>

      {/* Overview Section */}
      <div className="p-6">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Overview</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Midcurve sends HTTP POST requests to your webhook URL when events occur on your positions.
          Each request includes headers for authentication and event identification, along with a JSON
          payload containing event details.
        </p>
      </div>

      {/* HTTP Headers Section */}
      <div className="p-6">
        <h3 className="text-sm font-medium text-slate-200 mb-3">HTTP Headers</h3>
        <div className="bg-slate-900/50 rounded-lg p-4 font-mono text-sm space-y-2">
          <div className="flex">
            <span className="text-blue-400 w-48 flex-shrink-0">Content-Type:</span>
            <span className="text-slate-300">application/json</span>
          </div>
          <div className="flex">
            <span className="text-blue-400 w-48 flex-shrink-0">User-Agent:</span>
            <span className="text-slate-300">Midcurve-Webhook/1.0</span>
          </div>
          <div className="flex">
            <span className="text-blue-400 w-48 flex-shrink-0">X-Webhook-Secret:</span>
            <span className="text-slate-300">&lt;your-webhook-secret&gt;</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Verify the X-Webhook-Secret header matches your configured secret to authenticate requests.
        </p>
      </div>

      {/* Event Catalogue - Two Column Layout */}
      <div className="p-6">
        <h3 className="text-sm font-medium text-slate-200 mb-4">Event Types</h3>
        <div className="flex gap-6">
          {/* Left Column - Event Menu */}
          <div className="w-56 flex-shrink-0 space-y-1">
            {EVENT_TYPES.map((event) => (
              <button
                key={event.value}
                onClick={() => setSelectedEvent(event.value)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  selectedEvent === event.value
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                {event.label}
              </button>
            ))}
          </div>

          {/* Right Column - Event Details */}
          <div className="flex-1 min-w-0">
            {/* Event Title & Description */}
            <div className="mb-4">
              <h4 className="text-base font-medium text-slate-100 mb-1">
                {selectedEventDoc.label}
              </h4>
              <p className="text-sm text-slate-400">{selectedEventDoc.description}</p>
            </div>

            {/* Webhook URL + Test */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Webhook URL
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono truncate">
                  {webhookUrl}
                </code>
                <button
                  onClick={() => onTest(selectedEvent)}
                  disabled={isTesting}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {isTesting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Test
                </button>
              </div>
              {testResult && (
                <div
                  className={`flex items-center gap-2 mt-2 p-2 rounded-lg text-sm ${
                    testResult.success
                      ? 'bg-green-900/20 text-green-400'
                      : 'bg-red-900/20 text-red-400'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>

            {/* Event Type */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Key className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Event Type Value
                </span>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3 font-mono text-xs">
                <span className="text-blue-400">eventType:</span>{' '}
                <span className="text-green-400">&quot;{selectedEvent}&quot;</span>
              </div>
            </div>

            {/* Example Payload */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Send className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Example Payload
                </span>
              </div>
              <pre className="bg-slate-900/50 rounded-lg p-4 overflow-x-auto text-xs font-mono text-slate-300 max-h-80 overflow-y-auto">
                {JSON.stringify(selectedEventDoc.examplePayload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function WebhookSettings() {
  // UI State
  const [mode, setMode] = useState<ViewMode>('empty');

  // Form State
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [enabledEvents, setEnabledEvents] = useState<NotificationEventType[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Queries and mutations
  const { data: config, isLoading, isError } = useWebhookConfig();
  const updateConfig = useUpdateWebhookConfig();
  const testWebhook = useTestWebhook();

  // Sync form state with server data and determine mode
  useEffect(() => {
    if (config) {
      // Set mode based on whether webhook is configured
      setMode(config.webhookUrl ? 'view' : 'empty');

      // Sync form state
      setWebhookUrl(config.webhookUrl || '');
      setWebhookSecret(''); // Don't show existing secret
      setIsActive(config.isActive);
      setEnabledEvents((config.enabledEvents as NotificationEventType[]) || []);
      setHasChanges(false);
      setTestResult(null);
    }
  }, [config]);

  // Handlers
  const handleUrlChange = (url: string) => {
    setWebhookUrl(url);
    setHasChanges(true);
    setTestResult(null);
  };

  const handleGenerateSecret = () => {
    const secret = generateSecret();
    setWebhookSecret(secret);
    setHasChanges(true);
  };

  const handleCopySecret = async () => {
    if (webhookSecret) {
      await navigator.clipboard.writeText(webhookSecret);
    }
  };

  const handleEventToggle = (eventType: NotificationEventType) => {
    setEnabledEvents((prev) => {
      const next = prev.includes(eventType)
        ? prev.filter((e) => e !== eventType)
        : [...prev, eventType];
      setHasChanges(true);
      return next;
    });
  };

  const handleSelectAll = () => {
    setEnabledEvents(EVENT_TYPES.map((e) => e.value));
    setHasChanges(true);
  };

  const handleDeselectAll = () => {
    setEnabledEvents([]);
    setHasChanges(true);
  };

  // Save configuration
  const handleSave = () => {
    const body: UpdateWebhookConfigBody = {
      webhookUrl: webhookUrl || undefined,
      isActive: mode === 'create' ? true : isActive, // Auto-enable on create
      enabledEvents,
    };

    // Only include secret if it was changed
    if (webhookSecret) {
      body.webhookSecret = webhookSecret;
    }

    updateConfig.mutate(body, {
      onSuccess: () => {
        setHasChanges(false);
        setWebhookSecret(''); // Clear secret after save
        setMode('view');
      },
    });
  };

  // Cancel editing
  const handleCancel = () => {
    if (config) {
      // Reset form state to server values
      setWebhookUrl(config.webhookUrl || '');
      setWebhookSecret('');
      setIsActive(config.isActive);
      setEnabledEvents((config.enabledEvents as NotificationEventType[]) || []);
      setHasChanges(false);
      setTestResult(null);
    }
    setMode(config?.webhookUrl ? 'view' : 'empty');
  };

  // Toggle active status (direct API call from view mode)
  const handleToggleActive = () => {
    const newActive = !isActive;
    setIsActive(newActive);
    updateConfig.mutate({ isActive: newActive });
  };

  // Test webhook with specific event type
  const handleTest = (eventType?: NotificationEventType) => {
    setTestResult(null);
    testWebhook.mutate(eventType, {
      onSuccess: (result) => {
        setTestResult({
          success: result.success,
          message: result.success
            ? `Webhook delivered successfully (${result.statusCode})`
            : result.error || 'Webhook delivery failed',
        });
      },
      onError: (error) => {
        setTestResult({
          success: false,
          message: error.message || 'Failed to send test webhook',
        });
      },
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm text-red-400 font-medium">Failed to load webhook settings</p>
      </div>
    );
  }

  // Render based on mode
  return (
    <>
      {/* STATE 1: Empty - No webhook configured */}
      {mode === 'empty' && <EmptyState onCreateClick={() => setMode('create')} />}

      {/* STATE 2 & 4: Create/Edit Form */}
      {(mode === 'create' || mode === 'edit') && (
        <WebhookForm
          mode={mode}
          webhookUrl={webhookUrl}
          webhookSecret={webhookSecret}
          hasExistingSecret={config?.hasSecret ?? false}
          enabledEvents={enabledEvents}
          onUrlChange={handleUrlChange}
          onGenerateSecret={handleGenerateSecret}
          onCopySecret={handleCopySecret}
          onEventToggle={handleEventToggle}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onSave={handleSave}
          onCancel={handleCancel}
          isSaving={updateConfig.isPending}
          hasChanges={hasChanges}
        />
      )}

      {/* STATE 3: View - Webhook configured */}
      {mode === 'view' && config?.webhookUrl && (
        <WebhookView
          url={config.webhookUrl}
          hasSecret={config.hasSecret}
          enabledEvents={config.enabledEvents}
          isActive={isActive}
          isToggling={updateConfig.isPending}
          lastDelivery={
            config.lastDeliveryAt
              ? {
                  at: config.lastDeliveryAt,
                  status: config.lastDeliveryStatus,
                  error: config.lastDeliveryError,
                }
              : null
          }
          onEditClick={() => setMode('edit')}
          onToggleActive={handleToggleActive}
          onDocsClick={() => setMode('docs')}
        />
      )}

      {/* STATE 5: Documentation */}
      {mode === 'docs' && config?.webhookUrl && (
        <WebhookDocs
          webhookUrl={config.webhookUrl}
          onBack={() => setMode('view')}
          onTest={handleTest}
          isTesting={testWebhook.isPending}
          testResult={testResult}
        />
      )}
    </>
  );
}
