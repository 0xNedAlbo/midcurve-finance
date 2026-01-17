/**
 * Notifications Page
 *
 * Full-page view for managing notifications and webhook settings.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../providers/AuthProvider';
import { NotificationList } from '../components/notifications/notification-list';
import { WebhookSettings } from '../components/notifications/webhook-settings';
import { notificationKeys } from '../hooks/notifications/useNotifications';
import { ArrowLeft, Bell, Webhook, RefreshCw } from 'lucide-react';

type Tab = 'notifications' | 'webhooks';

export function NotificationsPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Read tab from URL, default to 'notifications'
  const activeTab = (
    searchParams.get('tab') === 'webhooks' ? 'webhooks' : 'notifications'
  ) as Tab;

  const handleTabChange = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    setSearchParams(params);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (activeTab === 'notifications') {
      await queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
      await queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
    } else {
      await queryClient.invalidateQueries({ queryKey: notificationKeys.webhookConfig() });
    }
    setIsRefreshing(false);
  };

  // Handle authentication redirect
  useEffect(() => {
    if (status === 'unauthenticated' || (!user && status !== 'loading')) {
      navigate('/?modal=signin');
    }
  }, [status, user, navigate]);

  // Show loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  // Don't render anything while redirecting
  if (status === 'unauthenticated' || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <div className="bg-slate-800/50 border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Bell className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Notifications</h1>
                <p className="text-sm text-slate-400">
                  {activeTab === 'notifications'
                    ? 'View and manage your position notifications'
                    : 'Configure webhook delivery for real-time alerts'}
                </p>
              </div>
            </div>

            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg w-fit mb-8">
          <button
            onClick={() => handleTabChange('notifications')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'notifications'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-4 h-4" />
            Notifications
          </button>
          <button
            onClick={() => handleTabChange('webhooks')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'webhooks'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Webhook className="w-4 h-4" />
            Webhooks
          </button>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'notifications' ? <NotificationList /> : <WebhookSettings />}
      </div>
    </div>
  );
}
