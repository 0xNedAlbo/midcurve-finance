/**
 * NavChart - Area chart showing daily NAV values over time
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { NavTimelineResponse } from '@midcurve/api-shared';
import { formatReportingAmount } from '@/lib/format-helpers';

interface NavChartProps {
  data: NavTimelineResponse | undefined;
}

interface ChartPoint {
  date: string;
  dateLabel: string;
  nav: number;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-slate-400">{point.dateLabel}</p>
      <p className="text-sm font-semibold text-white">
        {formatReportingAmount(String(BigInt(Math.round(point.nav))))}
      </p>
    </div>
  );
}

export function NavChart({ data }: NavChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-8 text-center">
        <p className="text-slate-400">No NAV data available yet</p>
      </div>
    );
  }

  const chartData: ChartPoint[] = data.map((point) => ({
    date: point.date,
    dateLabel: formatDate(point.date),
    nav: Number(BigInt(point.netAssetValue)),
  }));

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4">NAV Over Time</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={{ stroke: '#334155' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatReportingAmount(String(BigInt(Math.round(v))))}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="nav"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#navGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
