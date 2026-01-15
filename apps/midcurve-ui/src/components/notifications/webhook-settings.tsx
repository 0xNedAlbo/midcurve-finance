/**
 * Webhook Settings Component
 *
 * Configure webhook URL, event types, and test webhook delivery.
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
} from 'lucide-react';
import {
  useWebhookConfig,
  useUpdateWebhookConfig,
  useTestWebhook,
} from '@/hooks/notifications';
import type { NotificationEventType, UpdateWebhookConfigBody } from '@midcurve/api-shared';

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

export function WebhookSettings() {
  // State
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

  // Sync form state with server data
  useEffect(() => {
    if (config) {
      setWebhookUrl(config.webhookUrl || '');
      setWebhookSecret(''); // Don't show existing secret
      setIsActive(config.isActive);
      setEnabledEvents((config.enabledEvents as NotificationEventType[]) || []);
      setHasChanges(false);
    }
  }, [config]);

  // Track changes
  const handleUrlChange = (url: string) => {
    setWebhookUrl(url);
    setHasChanges(true);
    setTestResult(null);
  };

  const handleSecretChange = (secret: string) => {
    setWebhookSecret(secret);
    setHasChanges(true);
  };

  const handleActiveChange = (active: boolean) => {
    setIsActive(active);
    setHasChanges(true);
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
      isActive,
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
      },
    });
  };

  // Test webhook
  const handleTest = () => {
    setTestResult(null);
    testWebhook.mutate(undefined, {
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

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 divide-y divide-slate-700/50">
      {/* Enable/Disable Toggle */}
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-slate-100">Webhook Notifications</h3>
            <p className="text-sm text-slate-400 mt-1">
              Receive HTTP POST notifications when events occur
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => handleActiveChange(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
          </label>
        </div>
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
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://your-server.com/webhook"
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Notifications will be sent as POST requests to this URL
          </p>
        </label>
      </div>

      {/* Webhook Secret */}
      <div className="p-6">
        <label className="block">
          <div className="flex items-center gap-2 mb-2">
            <Key className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-200">Webhook Secret</span>
            <span className="text-xs text-slate-500">(optional)</span>
          </div>
          <input
            type="password"
            value={webhookSecret}
            onChange={(e) => handleSecretChange(e.target.value)}
            placeholder={config?.hasSecret ? '••••••••' : 'Enter a secret key'}
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Sent as X-Webhook-Secret header for verification
          </p>
        </label>
      </div>

      {/* Event Types */}
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-slate-200">Event Types</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
            >
              Select all
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={handleDeselectAll}
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
                onChange={() => handleEventToggle(event.value)}
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
          {/* Test Button */}
          <button
            onClick={handleTest}
            disabled={!webhookUrl || testWebhook.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testWebhook.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send Test
          </button>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateConfig.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateConfig.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>

        {/* Test Result */}
        {testResult && (
          <div
            className={`flex items-center gap-2 mt-4 p-3 rounded-lg ${
              testResult.success ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'
            }`}
          >
            {testResult.success ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <p className="text-sm">{testResult.message}</p>
          </div>
        )}

        {/* Update Result */}
        {updateConfig.isSuccess && !hasChanges && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-green-900/20 text-green-400">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">Settings saved successfully</p>
          </div>
        )}

        {updateConfig.isError && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-red-900/20 text-red-400">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">Failed to save settings</p>
          </div>
        )}
      </div>
    </div>
  );
}
