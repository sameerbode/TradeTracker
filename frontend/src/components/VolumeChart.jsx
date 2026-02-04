import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getDailyStats } from '../api/client';

export default function VolumeChart() {
    const { data: dailyStats, isLoading } = useQuery({
        queryKey: ['dailyStats'],
        queryFn: () => getDailyStats(30),
    });

    if (isLoading) {
        return (
            <div className="bg-white rounded-lg shadow p-4 mb-6">
                <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
                <div className="h-64 bg-gray-100 rounded animate-pulse"></div>
            </div>
        );
    }

    if (!dailyStats || dailyStats.length === 0) {
        return null;
    }

    const chartData = [...dailyStats].reverse().map((day) => ({
        date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        volume: day.total_volume || 0,
        trades: day.trade_count || 0,
    }));

    const formatCurrency = (value) => {
        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
        return `$${value}`;
    };

    return (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
            <h2 className="text-lg font-semibold mb-4">Daily Volume (Last 30 Days)</h2>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 12 }} />
                        <Tooltip
                            formatter={(value) => [formatCurrency(value), 'Volume']}
                            labelStyle={{ fontWeight: 'bold' }}
                        />
                        <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
