import { useQuery } from '@tanstack/react-query';
import { getStats } from '../api/client';

export default function StatsCards() {
    const { data: stats, isLoading, error } = useQuery({
        queryKey: ['stats'],
        queryFn: getStats,
    });

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white rounded-lg shadow p-4 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                        <div className="h-8 bg-gray-200 rounded w-3/4"></div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return <div className="text-red-500 mb-6">Failed to load stats</div>;
    }

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(value || 0);
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
                <p className="text-gray-500 text-sm">Total Trades</p>
                <p className="text-2xl font-bold">{stats?.total_trades || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
                <p className="text-gray-500 text-sm">Total Volume</p>
                <p className="text-2xl font-bold">{formatCurrency(stats?.total_volume)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
                <p className="text-gray-500 text-sm">Total Fees</p>
                <p className="text-2xl font-bold">{formatCurrency(stats?.total_fees)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
                <p className="text-gray-500 text-sm">Top Symbol</p>
                <p className="text-2xl font-bold">
                    {stats?.top_symbols?.[0]?.symbol || '-'}
                </p>
            </div>
        </div>
    );
}
