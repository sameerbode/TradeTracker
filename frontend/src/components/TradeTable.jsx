import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getTrades, deleteTrade, toggleTradeReview } from '../api/client';

export default function TradeTable({ filters = {} }) {
    const queryClient = useQueryClient();
    const [sortConfig, setSortConfig] = useState({ key: 'executed_at', direction: 'desc' });
    const [reviewFilter, setReviewFilter] = useState('all'); // 'all', 'review'

    const { data: trades, isLoading, error } = useQuery({
        queryKey: ['trades', filters],
        queryFn: () => getTrades(filters),
    });

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const SortIcon = ({ columnKey }) => (
        <span className="ml-1 inline-block">
            {sortConfig.key === columnKey ? (
                sortConfig.direction === 'asc' ? (
                    <svg className="h-3 w-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                ) : (
                    <svg className="h-3 w-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                )
            ) : (
                <svg className="h-3 w-3 inline opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
            )}
        </span>
    );

    // Filter trades by search and review
    const filteredTrades = (trades || []).filter(t => {
        if (reviewFilter === 'review' && !t.review) return false;
        if (filters.search) {
            const searchUpper = filters.search.toUpperCase();
            const getBase = (s) => s?.replace(/\d.*$/, '').replace(/W$/, '').toUpperCase();
            return getBase(t.symbol) === searchUpper;
        }
        return true;
    });

    const reviewCount = trades?.filter(t => t.review).length || 0;

    // Sort trades
    const sortedTrades = [...filteredTrades].sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // Handle dates
        if (sortConfig.key === 'executed_at') {
            aVal = new Date(aVal).getTime();
            bVal = new Date(bVal).getTime();
        }

        // Handle strings
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return sortConfig.direction === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        }

        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    const deleteM = useMutation({
        mutationFn: deleteTrade,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        },
    });

    const reviewM = useMutation({
        mutationFn: toggleTradeReview,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['positions'] });
        },
    });

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(value || 0);
    };

    return (
        <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-lg font-semibold">Trades</h2>
                    {reviewCount > 0 && (
                        <div className="text-sm text-orange-600">
                            {reviewCount} for review
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setReviewFilter('all')}
                        className={`px-3 py-1 rounded text-sm ${reviewFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
                    >
                        All
                    </button>
                    <button
                        onClick={() => setReviewFilter('review')}
                        className={`px-3 py-1 rounded text-sm ${reviewFilter === 'review' ? 'bg-orange-600 text-white' : 'bg-gray-100'}`}
                    >
                        Review
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="p-8 text-center text-gray-500">Loading trades...</div>
            ) : error ? (
                <div className="p-8 text-center text-red-500">Failed to load trades</div>
            ) : trades?.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                    No trades yet. Import a CSV or PDF to get started.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('executed_at')}>
                                    Date<SortIcon columnKey="executed_at" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('symbol')}>
                                    Symbol<SortIcon columnKey="symbol" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('asset_type')}>
                                    Type<SortIcon columnKey="asset_type" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('side')}>
                                    Side<SortIcon columnKey="side" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('quantity')}>
                                    Qty<SortIcon columnKey="quantity" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('price')}>
                                    Price<SortIcon columnKey="price" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                                    Total<SortIcon columnKey="total" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('broker')}>
                                    Broker<SortIcon columnKey="broker" />
                                </th>
                                <th className="px-4 py-3 text-center font-medium text-gray-600">Review</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {sortedTrades?.map((trade) => (
                                <tr key={trade.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        {formatDate(trade.executed_at)}
                                    </td>
                                    <td className="px-4 py-3 font-medium">{trade.symbol}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                            trade.asset_type === 'future' ? 'bg-purple-100 text-purple-700' :
                                            trade.asset_type === 'option' ? 'bg-blue-100 text-blue-700' :
                                            'bg-gray-100 text-gray-700'
                                        }`}>
                                            {trade.asset_type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                            trade.side === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                            {trade.side}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">{trade.quantity}</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(trade.price)}</td>
                                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(trade.total)}</td>
                                    <td className="px-4 py-3 capitalize flex items-center gap-1">
                                        {trade.broker}
                                        {trade.import_filename && (
                                            <span className="relative group">
                                                <svg className="h-4 w-4 text-gray-400 hover:text-blue-500 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                                                    {trade.import_filename}
                                                </span>
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            onClick={() => reviewM.mutate(trade.id)}
                                            className={`px-2 py-1 rounded text-xs ${
                                                trade.review
                                                    ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                            }`}
                                            title={trade.review ? 'Remove from review' : 'Add to review'}
                                        >
                                            {trade.review ? 'Reviewing' : 'Mark'}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={() => {
                                                if (confirm('Delete this trade?')) {
                                                    deleteM.mutate(trade.id);
                                                }
                                            }}
                                            className="text-red-500 hover:text-red-700 text-xs"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
