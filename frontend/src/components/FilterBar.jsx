import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSymbols, getAccounts } from '../api/client';

export default function FilterBar({ filters, onChange }) {
    const [isOpen, setIsOpen] = useState(false);

    const { data: symbols } = useQuery({
        queryKey: ['symbols'],
        queryFn: getSymbols,
    });

    const { data: accounts } = useQuery({
        queryKey: ['accounts'],
        queryFn: getAccounts,
    });

    const updateFilter = (key, value) => {
        onChange({ ...filters, [key]: value || undefined });
    };

    const clearFilters = () => {
        onChange({});
        setIsOpen(false);
    };

    const activeFilterCount = Object.values(filters).filter(Boolean).length;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
                    activeFilterCount > 0
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                }`}
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                    <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">
                        {activeFilterCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-lg border p-4 z-10 min-w-[300px]">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium">Filters</h3>
                        <button
                            onClick={clearFilters}
                            className="text-sm text-blue-600 hover:text-blue-800"
                        >
                            Clear all
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Symbol</label>
                            <select
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={filters.symbol || ''}
                                onChange={(e) => updateFilter('symbol', e.target.value)}
                            >
                                <option value="">All Symbols</option>
                                {symbols?.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Asset Type</label>
                            <select
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={filters.asset_type || ''}
                                onChange={(e) => updateFilter('asset_type', e.target.value)}
                            >
                                <option value="">All Types</option>
                                <option value="stock">Stock</option>
                                <option value="option">Option</option>
                                <option value="future">Future</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Broker</label>
                            <select
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={filters.broker || ''}
                                onChange={(e) => updateFilter('broker', e.target.value)}
                            >
                                <option value="">All Brokers</option>
                                <option value="robinhood">Robinhood</option>
                                <option value="webull">Webull</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Side</label>
                            <select
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={filters.side || ''}
                                onChange={(e) => updateFilter('side', e.target.value)}
                            >
                                <option value="">All Sides</option>
                                <option value="buy">Buy</option>
                                <option value="sell">Sell</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                            <input
                                type="date"
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={filters.from_date || ''}
                                onChange={(e) => updateFilter('from_date', e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                            <input
                                type="date"
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={filters.to_date || ''}
                                onChange={(e) => updateFilter('to_date', e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        onClick={() => setIsOpen(false)}
                        className="mt-4 w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
                    >
                        Apply
                    </button>
                </div>
            )}
        </div>
    );
}
