/**
 * Notifications Page
 *
 * Full-page view for managing notifications and webhook settings.
 */

import { useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import { UserDropdown } from '../components/auth/user-dropdown';
import { NotificationBell } from '../components/notifications/notification-bell';
import { NotificationList } from '../components/notifications/notification-list';
import { WebhookSettings } from '../components/notifications/webhook-settings';
import { ArrowLeft, Bell, Webhook } from 'lucide-react';

type Tab = 'notifications' | 'webhooks';

export function NotificationsPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read tab from URL, default to 'notifications'
  const activeTab = (
    searchParams.get('tab') === 'webhooks' ? 'webhooks' : 'notifications'
  ) as Tab;

  const handleTabChange = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    setSearchParams(params);
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
      <div className="max-w-[1200px] mx-auto px-2 md:px-4 lg:px-6 py-8">
        {/* Header */}
        <header className="flex justify-between items-center mb-12">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Midcurve</h1>
              <p className="text-lg text-slate-300">Notifications</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <UserDropdown />
          </div>
        </header>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Section Header */}
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {activeTab === 'notifications' ? 'Notifications' : 'Webhook Settings'}
            </h2>
            <p className="text-slate-300">
              {activeTab === 'notifications'
                ? 'View and manage your position notifications'
                : 'Configure webhook delivery for real-time alerts'}
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg w-fit">
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
    </div>
  );
}
