/**
 * Strategy Detail Page
 *
 * Page component for displaying strategy details.
 * Fetches strategy data and renders the detail layout.
 */

import { useParams } from "react-router-dom";
import { useStrategy } from "../hooks/strategies/useStrategy";
import { StrategyDetailLayout } from "../components/strategies/strategy-detail-layout";
import { AlertCircle, Loader2 } from "lucide-react";

export function StrategyDetailPage() {
  const params = useParams();

  // Extract strategy ID from params
  const strategyId = params?.strategyId as string | undefined;

  // Fetch strategy data
  const {
    data: strategy,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useStrategy(strategyId || "");

  // Handle loading state when params aren't ready yet
  if (!strategyId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
              </div>
              <h3 className="text-xl font-semibold text-white">Loading...</h3>
              <p className="text-slate-400">Initializing page...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
              </div>
              <h3 className="text-xl font-semibold text-white">
                Loading Strategy
              </h3>
              <p className="text-slate-400">Fetching strategy data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="p-4 bg-red-500/20 rounded-full">
                  <AlertCircle className="w-12 h-12 text-red-400" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-white">
                Error Loading Strategy
              </h3>
              <p className="text-slate-400 max-w-md">
                {error instanceof Error
                  ? error.message
                  : "Failed to fetch strategy data"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not found state
  if (!strategy) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="p-4 bg-amber-500/20 rounded-full">
                  <AlertCircle className="w-12 h-12 text-amber-400" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-white">
                Strategy Not Found
              </h3>
              <p className="text-slate-400 max-w-md">
                Could not find strategy with ID: {strategyId}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render strategy detail
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-[1600px] mx-auto px-2 md:px-4 lg:px-6 py-8">
        <StrategyDetailLayout
          strategy={strategy}
          onRefresh={async () => {
            await refetch();
          }}
          isRefreshing={isFetching}
        />
      </div>
    </div>
  );
}
