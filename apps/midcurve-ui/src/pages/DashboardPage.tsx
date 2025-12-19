import { useAuth } from '../providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { UserDropdown } from '../components/auth/user-dropdown';
import { CreatePositionDropdown } from '../components/positions/create-position-dropdown';
import { CreateStrategyDropdown } from '../components/strategies/create-strategy-dropdown';
import { PositionList } from '../components/positions/position-list';

export function DashboardPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();

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
      <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
        {/* Header */}
        <header className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Midcurve</h1>
            <p className="text-lg text-slate-300">Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <UserDropdown />
          </div>
        </header>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Section Header with Add Position Button */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Your Positions
              </h2>
              <p className="text-slate-300">
                Manage and analyze your Uniswap V3 liquidity positions
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <CreateStrategyDropdown />
              <CreatePositionDropdown />
            </div>
          </div>

          {/* Position List */}
          <PositionList />
        </div>
      </div>
    </div>
  );
}
