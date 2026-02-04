import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getPositions } from '../api/client';

export default function QueueTable({ filters = {} }) {
    const [sortConfig, setSortConfig] = useState({ key: 'buyDate', direction: 'desc' });

    const { data: positions, isLoading, error } = useQuery({
        queryKey: ['positions'],
        queryFn: getPositions,
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

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: '2-digit',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const formatCurrency = (value) => {
        if (value === null || value === undefined) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(value);
    };

    // Filter to only open positions
    const openPositions = positions?.filter(p => {
        if (p.status !== 'open') return false;

        // Apply search filter
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const symbolMatch = p.symbol?.toLowerCase().includes(searchLower);
            const displayMatch = p.displaySymbol?.toLowerCase().includes(searchLower);
            if (!symbolMatch && !displayMatch) return false;
        }

        // Apply other filters
        if (filters.symbol && p.symbol !== filters.symbol) return false;
        if (filters.asset_type && p.asset_type !== filters.asset_type) return false;
        if (filters.broker && p.broker !== filters.broker) return false;

        return true;
    }) || [];

    // Sort
    const sortedPositions = [...openPositions].sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        if (aVal === null || aVal === undefined) aVal = sortConfig.direction === 'asc' ? Infinity : -Infinity;
        if (bVal === null || bVal === undefined) bVal = sortConfig.direction === 'asc' ? Infinity : -Infinity;

        if (sortConfig.key.includes('Date')) {
            aVal = aVal ? new Date(aVal).getTime() : 0;
            bVal = bVal ? new Date(bVal).getTime() : 0;
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return sortConfig.direction === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        }

        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    const totalValue = openPositions.reduce((sum, p) => sum + (p.buyTotal || 0), 0);

    return (
        <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-semibold">Open Queue</h2>
                    <div className="text-sm text-gray-600">
                        {openPositions.length} open position{openPositions.length !== 1 ? 's' : ''} |
                        Total: <span className="font-medium">{formatCurrency(totalValue)}</span>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="p-8 text-center text-gray-500">Loading queue...</div>
            ) : error ? (
                <div className="p-8 text-center text-red-500">Failed to load queue</div>
            ) : sortedPositions.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                    No open positions in queue.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('displaySymbol')}>
                                    Symbol<SortIcon columnKey="displaySymbol" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('asset_type')}>
                                    Type<SortIcon columnKey="asset_type" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('quantity')}>
                                    Qty<SortIcon columnKey="quantity" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('buyPrice')}>
                                    Buy Price<SortIcon columnKey="buyPrice" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('buyTotal')}>
                                    Total<SortIcon columnKey="buyTotal" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('buyDate')}>
                                    Date<SortIcon columnKey="buyDate" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('broker')}>
                                    Broker<SortIcon columnKey="broker" />
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {sortedPositions.map((pos, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium" title={pos.symbol}>
                                        {pos.displaySymbol}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                            pos.asset_type === 'future' ? 'bg-purple-100 text-purple-700' :
                                            pos.asset_type === 'option' ? 'bg-blue-100 text-blue-700' :
                                            'bg-gray-100 text-gray-700'
                                        }`}>
                                            {pos.asset_type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">{pos.quantity}</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(pos.buyPrice)}</td>
                                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(pos.buyTotal)}</td>
                                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(pos.buyDate)}</td>
                                    <td className="px-4 py-3 capitalize">{pos.broker}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
