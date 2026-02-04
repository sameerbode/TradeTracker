import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, Fragment } from 'react';
import {
    getRoundTripPositions,
    setTradesReview,
    expireTrades,
    getStrategies,
    createStrategy,
    addTradesToStrategy,
    deleteStrategy,
    updateStrategy,
} from '../api/client';

/**
 * Parse OCC option symbol and format as "AAPL 230C 1/6/26"
 */
function formatOptionDisplay(symbol, assetType, expirationDate = null) {
    if (assetType !== 'option') return symbol;

    // Try to parse OCC format: SPXW260107P06920000
    const match = symbol?.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (match) {
        const [, underlying, dateStr, type, strikeStr] = match;
        const month = parseInt(dateStr.substring(2, 4));
        const day = parseInt(dateStr.substring(4, 6));
        const year = parseInt(dateStr.substring(0, 2));
        const strike = Math.round(parseInt(strikeStr) / 1000);
        const cleanUnderlying = underlying.endsWith('W') ? underlying.slice(0, -1) : underlying;
        return `${cleanUnderlying} ${strike}${type} ${month}/${day}/${year}`;
    }

    // Fallback: use expiration date if available
    if (expirationDate) {
        const exp = new Date(expirationDate);
        const dateStr = `${exp.getMonth() + 1}/${exp.getDate()}/${exp.getFullYear() % 100}`;
        return `${symbol} ${dateStr}`;
    }

    return symbol;
}

export default function StrategiesView({ filters = {} }) {
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState('all');
    const [expandedRows, setExpandedRows] = useState(new Set());
    const [sortConfig, setSortConfig] = useState({ key: 'sellDate', direction: 'desc' });
    const [draggedItem, setDraggedItem] = useState(null);
    const [dropTarget, setDropTarget] = useState(null);
    const [hoverBasketId, setHoverBasketId] = useState(null); // Which basket is being hovered
    const [baskets, setBaskets] = useState([{ id: 1, name: '', items: [] }]); // Multiple baskets
    const [nextBasketId, setNextBasketId] = useState(2);
    const [editingStrategyId, setEditingStrategyId] = useState(null);
    const [editingName, setEditingName] = useState('');

    // Queries
    const { data: positions = [], isLoading: loadingPositions } = useQuery({
        queryKey: ['positions', 'roundtrip'],
        queryFn: getRoundTripPositions,
    });

    const { data: strategies = [], isLoading: loadingStrategies } = useQuery({
        queryKey: ['strategies'],
        queryFn: getStrategies,
    });

    // Mutations
    // Review status: 0=none, 1=reviewing, 2=reviewed
    const reviewMutation = useMutation({
        mutationFn: ({ tradeIds, status }) => setTradesReview(tradeIds, status),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['positions'] });
            queryClient.invalidateQueries({ queryKey: ['strategies'] });
        },
    });

    const expireMutation = useMutation({
        mutationFn: (tradeIds) => expireTrades(tradeIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['positions'] });
            queryClient.invalidateQueries({ queryKey: ['strategies'] });
        },
    });

    const createStrategyMutation = useMutation({
        mutationFn: ({ name, tradeIds }) => createStrategy(name, tradeIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['strategies'] });
        },
    });

    const addToStrategyMutation = useMutation({
        mutationFn: ({ strategyId, tradeIds }) => addTradesToStrategy(strategyId, tradeIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['strategies'] });
        },
    });

    const deleteStrategyMutation = useMutation({
        mutationFn: deleteStrategy,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['strategies'] });
        },
    });

    const updateStrategyMutation = useMutation({
        mutationFn: ({ id, name }) => updateStrategy(id, { name }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['strategies'] });
            setEditingStrategyId(null);
        },
    });

    // Get trade IDs that are already in strategies
    const groupedTradeIds = new Set(strategies.flatMap(s => s.tradeIds || []));

    // Filter out positions whose trades are in strategies
    const ungroupedPositions = positions.filter(pos =>
        !pos.tradeIds?.some(id => groupedTradeIds.has(id))
    );

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

    const toggleRow = (key) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    // Drag handlers - supports both positions and individual trades
    const handleDragStart = (e, item, type) => {
        setDraggedItem({ ...item, type });
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
    };

    const handleDragOver = (e, target) => {
        e.preventDefault();
        e.stopPropagation();
        // Allow drop if not dragging onto itself
        if (draggedItem) {
            const isSameItem = target.key === draggedItem.key;
            const isTradeInSamePosition = draggedItem.type === 'trade' &&
                target.type === 'position' &&
                target.tradeIds?.includes(draggedItem.tradeId);
            if (!isSameItem && !isTradeInSamePosition) {
                setDropTarget(target);
            }
        }
    };

    const handleDragLeave = (e) => {
        e.stopPropagation();
        setDropTarget(null);
    };

    const handleDrop = (e, target) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);

        if (!draggedItem) return;

        // Get trade IDs from dragged item (single trade or position/strategy)
        const draggedTradeIds = draggedItem.type === 'trade'
            ? [draggedItem.tradeId]
            : (draggedItem.tradeIds || []);

        if (target.type === 'strategy') {
            // Drop onto existing strategy
            addToStrategyMutation.mutate({
                strategyId: target.id,
                tradeIds: draggedTradeIds,
            });
            // If dragging a whole strategy, delete the old one
            if (draggedItem.type === 'strategy') {
                deleteStrategyMutation.mutate(draggedItem.id);
            }
        } else if (target.type === 'position' || target.type === 'trade') {
            // Drop onto position or trade - create new strategy
            const targetTradeIds = target.type === 'trade'
                ? [target.tradeId]
                : (target.tradeIds || []);
            const allTradeIds = [...new Set([...draggedTradeIds, ...targetTradeIds])];

            // Create name from the items being combined
            const draggedLabel = draggedItem.optionDisplay || draggedItem.displaySymbol || draggedItem.name || 'Trade';
            const targetLabel = target.optionDisplay || target.displaySymbol || 'Trade';
            const name = `${draggedLabel} + ${targetLabel}`;

            createStrategyMutation.mutate({ name, tradeIds: allTradeIds });
        }

        setDraggedItem(null);
    };

    const handleDragEnd = (e) => {
        e.stopPropagation();
        setDraggedItem(null);
        setDropTarget(null);
        setNewBasketHover(false);
    };

    const handleBasketDrop = (e, basketId) => {
        e.preventDefault();
        e.stopPropagation();
        setHoverBasketId(null);

        if (!draggedItem) return;

        // Get trade IDs and display info from dragged item
        const draggedTradeIds = draggedItem.type === 'trade'
            ? [draggedItem.tradeId]
            : (draggedItem.tradeIds || []);

        const displayName = draggedItem.optionDisplay || draggedItem.displaySymbol || draggedItem.name || 'Trade';

        // Add to specific basket (avoid duplicates across ALL baskets)
        setBaskets(prev => {
            const allExistingIds = new Set(prev.flatMap(b => b.items.flatMap(item => item.tradeIds)));
            const newIds = draggedTradeIds.filter(id => !allExistingIds.has(id));
            if (newIds.length === 0) return prev; // Already in a basket

            return prev.map(basket => {
                if (basket.id === basketId) {
                    return {
                        ...basket,
                        items: [...basket.items, { tradeIds: newIds, displayName, type: draggedItem.type }]
                    };
                }
                return basket;
            });
        });

        setDraggedItem(null);
    };

    const removeFromBasket = (basketId, itemIndex) => {
        setBaskets(prev => prev.map(basket => {
            if (basket.id === basketId) {
                return { ...basket, items: basket.items.filter((_, i) => i !== itemIndex) };
            }
            return basket;
        }));
    };

    const updateBasketName = (basketId, name) => {
        setBaskets(prev => prev.map(basket => {
            if (basket.id === basketId) {
                return { ...basket, name };
            }
            return basket;
        }));
    };

    const clearBasket = (basketId) => {
        setBaskets(prev => prev.map(basket => {
            if (basket.id === basketId) {
                return { ...basket, name: '', items: [] };
            }
            return basket;
        }));
    };

    const removeBasket = (basketId) => {
        setBaskets(prev => {
            const filtered = prev.filter(b => b.id !== basketId);
            // Always keep at least one basket
            if (filtered.length === 0) {
                return [{ id: nextBasketId, name: '', items: [] }];
            }
            return filtered;
        });
        if (baskets.length <= 1) {
            setNextBasketId(prev => prev + 1);
        }
    };

    const addNewBasket = () => {
        setBaskets(prev => [...prev, { id: nextBasketId, name: '', items: [] }]);
        setNextBasketId(prev => prev + 1);
    };

    const createStrategyFromBasket = (basketId) => {
        const basket = baskets.find(b => b.id === basketId);
        if (!basket || basket.items.length === 0) return;

        const allTradeIds = basket.items.flatMap(item => item.tradeIds);
        const name = basket.name.trim() || basket.items.map(item => item.displayName).join(' + ');

        createStrategyMutation.mutate({ name, tradeIds: allTradeIds });
        removeBasket(basketId);
    };

    const createAllStrategies = () => {
        const nonEmptyBaskets = baskets.filter(b => b.items.length > 0);
        if (nonEmptyBaskets.length === 0) return;

        nonEmptyBaskets.forEach(basket => {
            const allTradeIds = basket.items.flatMap(item => item.tradeIds);
            const name = basket.name.trim() || basket.items.map(item => item.displayName).join(' + ');
            createStrategyMutation.mutate({ name, tradeIds: allTradeIds });
        });

        // Reset to single empty basket
        setBaskets([{ id: nextBasketId, name: '', items: [] }]);
        setNextBasketId(prev => prev + 1);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: '2-digit',
            month: 'numeric',
            day: 'numeric',
        });
    };

    const formatCurrency = (value) => {
        if (value === null || value === undefined) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(value);
    };

    const formatPercent = (value) => {
        if (value === null || value === undefined) return '-';
        return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    };

    // Apply filters
    const applyFilters = (items) => items.filter(p => {
        if (statusFilter === 'open' && p.status !== 'open') return false;
        if (statusFilter === 'closed' && p.status !== 'closed' && p.status !== 'expired') return false;
        if (statusFilter === 'expired' && p.status !== 'expired') return false;
        if (statusFilter === 'review' && p.reviewStatus !== 1) return false;

        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const match = p.symbol?.toLowerCase().includes(searchLower) ||
                          p.displaySymbol?.toLowerCase().includes(searchLower) ||
                          p.name?.toLowerCase().includes(searchLower) ||
                          p.symbols?.some(s => s.toLowerCase().includes(searchLower));
            if (!match) return false;
        }

        return true;
    });

    const sortItems = (items) => [...items].sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        if (aVal === null || aVal === undefined) aVal = sortConfig.direction === 'asc' ? Infinity : -Infinity;
        if (bVal === null || bVal === undefined) bVal = sortConfig.direction === 'asc' ? Infinity : -Infinity;

        if (sortConfig.key.includes('Date')) {
            aVal = aVal ? new Date(aVal).getTime() : 0;
            bVal = bVal ? new Date(bVal).getTime() : 0;
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }

        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    const filteredPositions = applyFilters(ungroupedPositions);
    const filteredStrategies = applyFilters(strategies);

    // Combine positions and strategies, tag each, then sort together
    const allItems = [
        ...filteredPositions.map((pos) => ({ ...pos, _key: `pos-${pos.tradeIds?.join('-') || pos.symbol}`, _isStrategy: false })),
        ...filteredStrategies.map((s) => ({ ...s, _key: `strategy-${s.id}`, _isStrategy: true })),
    ];
    const sortedItems = sortItems(allItems);

    const totalPnl = allItems.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const totalVolume = allItems.reduce((sum, p) => sum + (p.buyTotal || 0) + (p.sellTotal || 0), 0);
    const totalTrades = allItems.reduce((sum, p) => sum + (p.trades?.length || p.legs || 0), 0);

    // Find top symbol
    const symbolCounts = {};
    allItems.forEach(p => {
        const symbols = p.symbols || [p.displaySymbol || p.symbol];
        symbols.forEach(s => {
            if (s) symbolCounts[s] = (symbolCounts[s] || 0) + 1;
        });
    });
    const topSymbol = Object.entries(symbolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

    const isLoading = loadingPositions || loadingStrategies;

    // Render row for both positions and strategies
    const renderRow = (item, key, isStrategy = false) => {
        const isExpanded = expandedRows.has(key);
        const isDragging = draggedItem?.key === key;
        const isDropping = dropTarget?.key === key;

        return (
            <Fragment key={key}>
                <tr
                    draggable
                    onDragStart={(e) => handleDragStart(e, { ...item, key }, isStrategy ? 'strategy' : 'position')}
                    onDragOver={(e) => handleDragOver(e, { ...item, key, type: isStrategy ? 'strategy' : 'position' })}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, { ...item, key, type: isStrategy ? 'strategy' : 'position' })}
                    onDragEnd={handleDragEnd}
                    onClick={() => toggleRow(key)}
                    className={`cursor-pointer transition-all ${
                        isStrategy ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-gray-50'
                    } ${isDragging ? 'opacity-50' : ''} ${
                        isDropping ? 'ring-2 ring-purple-500 ring-inset bg-purple-100' : ''
                    }`}
                >
                    <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                            {isStrategy && (
                                <span className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0" title="Strategy"></span>
                            )}
                            <svg
                                className={`h-4 w-4 transition-transform text-gray-400 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            {isStrategy ? (
                                editingStrategyId === item.id ? (
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onBlur={() => {
                                            if (editingName.trim()) {
                                                updateStrategyMutation.mutate({ id: item.id, name: editingName });
                                            }
                                            setEditingStrategyId(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') e.target.blur();
                                            if (e.key === 'Escape') setEditingStrategyId(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="px-1 py-0.5 border rounded text-sm w-40"
                                        autoFocus
                                    />
                                ) : (
                                    <span
                                        className="hover:underline cursor-text"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingStrategyId(item.id);
                                            setEditingName(item.name);
                                        }}
                                        title="Click to rename"
                                    >
                                        {item.name}
                                    </span>
                                )
                            ) : (
                                <span title={item.symbol}>{item.displaySymbol}</span>
                            )}
                            {isStrategy && (
                                <span className="text-xs text-purple-600">({item.legs} legs)</span>
                            )}
                            {isStrategy && item.hasExpiredLegs && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded" title="Some legs expired">
                                    {item.expiredLegs?.length} expired
                                </span>
                            )}
                        </span>
                    </td>
                    <td className="px-4 py-3">
                        {isStrategy ? (
                            <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">strategy</span>
                        ) : (
                            <span className={`px-2 py-0.5 rounded text-xs ${
                                item.asset_type === 'future' ? 'bg-purple-100 text-purple-700' :
                                item.asset_type === 'option' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                            }`}>
                                {item.asset_type}
                            </span>
                        )}
                    </td>
                    <td className="px-4 py-3 text-right">{isStrategy ? '-' : item.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(isStrategy ? item.totalBuy : item.buyTotal)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(isStrategy ? item.totalSell : item.sellTotal)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${
                        item.pnl === null ? 'text-gray-400' :
                        item.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                        {formatCurrency(item.pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right ${
                        item.pnlPercent === null ? 'text-gray-400' :
                        item.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                        {formatPercent(item.pnlPercent)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(item.buyDate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(item.sellDate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                        {!isStrategy && item.asset_type === 'option' ? formatDate(item.expirationDate) : '-'}
                    </td>
                    <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                            item.status === 'open' ? 'bg-yellow-100 text-yellow-700' :
                            item.status === 'pending_expiry' ? 'bg-orange-100 text-orange-700' :
                            item.status === 'expired' ? 'bg-red-100 text-red-700' :
                            'bg-green-100 text-green-700'
                        }`}>
                            {item.status === 'pending_expiry' ? 'action required' : item.status}
                        </span>
                    </td>
                    <td className="px-4 py-3 capitalize">{isStrategy ? '-' : item.broker}</td>
                    <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                            {(item.reviewStatus === 0 || item.reviewStatus === undefined) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        reviewMutation.mutate({
                                            tradeIds: item.tradeIds,
                                            status: 1
                                        });
                                    }}
                                    className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-500 hover:bg-gray-200"
                                >
                                    Review
                                </button>
                            )}
                            {item.reviewStatus === 1 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        reviewMutation.mutate({
                                            tradeIds: item.tradeIds,
                                            status: 2
                                        });
                                    }}
                                    className="px-2 py-1 rounded text-xs bg-orange-100 text-orange-700 hover:bg-orange-200"
                                >
                                    Reviewing
                                </button>
                            )}
                            {item.reviewStatus === 2 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        reviewMutation.mutate({
                                            tradeIds: item.tradeIds,
                                            status: 0
                                        });
                                    }}
                                    className="px-2 py-1 rounded text-xs bg-green-100 text-green-700 hover:bg-green-200 flex items-center gap-1"
                                    title="Click to reset review"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Reviewed
                                </button>
                            )}
                            {isStrategy && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Ungroup this strategy?')) {
                                            deleteStrategyMutation.mutate(item.id);
                                        }
                                    }}
                                    className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600"
                                    title="Ungroup"
                                >
                                    Ungroup
                                </button>
                            )}
                        </div>
                    </td>
                </tr>
                {isExpanded && (
                    <tr className={isStrategy ? 'bg-purple-50' : 'bg-gray-50'}>
                        <td colSpan={13} className="px-8 py-3">
                            <div className="text-xs text-gray-600 mb-2 font-medium">
                                {isStrategy ? 'Strategy Trades' : 'Trades'} - Drag individual trades to group
                            </div>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-gray-500">
                                        <th className="text-left py-1 pr-4 w-8"></th>
                                        <th className="text-left py-1 pr-4">Option/Symbol</th>
                                        <th className="text-left py-1 pr-4">Side</th>
                                        <th className="text-right py-1 pr-4">Qty</th>
                                        <th className="text-right py-1 pr-4">Price</th>
                                        <th className="text-right py-1 pr-4">Total</th>
                                        <th className="text-left py-1">Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {item.trades?.map((trade, tIdx) => {
                                        const optionDisplay = formatOptionDisplay(
                                            trade.symbol,
                                            trade.asset_type,
                                            trade.expiration_date
                                        );
                                        const tradeKey = `trade-${trade.id}`;
                                        const isTradeDropTarget = dropTarget?.key === tradeKey;
                                        const isTradeBeingDragged = draggedItem?.key === tradeKey;

                                        return (
                                            <tr
                                                key={tIdx}
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, {
                                                    key: tradeKey,
                                                    tradeId: trade.id,
                                                    optionDisplay,
                                                    displaySymbol: trade.displaySymbol || trade.symbol,
                                                }, 'trade')}
                                                onDragOver={(e) => handleDragOver(e, {
                                                    key: tradeKey,
                                                    tradeId: trade.id,
                                                    optionDisplay,
                                                    type: 'trade',
                                                })}
                                                onDragLeave={handleDragLeave}
                                                onDrop={(e) => handleDrop(e, {
                                                    key: tradeKey,
                                                    tradeId: trade.id,
                                                    optionDisplay,
                                                    type: 'trade',
                                                })}
                                                onDragEnd={handleDragEnd}
                                                className={`border-t border-gray-200 cursor-grab transition-all ${
                                                    isTradeBeingDragged ? 'opacity-50' : ''
                                                } ${isTradeDropTarget ? 'ring-2 ring-purple-500 ring-inset bg-purple-100' : ''}`}
                                            >
                                                <td className="py-1 pr-2">
                                                    <svg className="h-3 w-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                                        <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/>
                                                    </svg>
                                                </td>
                                                <td className="py-1 pr-4 font-medium text-blue-700" title={trade.symbol}>
                                                    {optionDisplay}
                                                </td>
                                                <td className="py-1 pr-4">
                                                    <span className={`px-2 py-0.5 rounded ${
                                                        trade.side === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                    }`}>
                                                        {trade.side}
                                                    </span>
                                                </td>
                                                <td className="text-right py-1 pr-4">{trade.quantity}</td>
                                                <td className="text-right py-1 pr-4">{formatCurrency(trade.price)}</td>
                                                <td className="text-right py-1 pr-4">{formatCurrency(trade.total)}</td>
                                                <td className="py-1">
                                                    {new Date(trade.executed_at).toLocaleString('en-US', {
                                                        month: 'numeric',
                                                        day: 'numeric',
                                                        year: '2-digit',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Pending expiry legs - need action */}
                            {isStrategy && item.pendingExpiryLegs?.length > 0 && (
                                <div className="mt-4 p-3 bg-orange-50 rounded border border-orange-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs font-medium text-orange-800">
                                            Expired Options - Action Required
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const allTradeIds = item.pendingExpiryLegs.flatMap(leg => leg.tradeIds);
                                                expireMutation.mutate(allTradeIds);
                                            }}
                                            className="px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                                            disabled={expireMutation.isPending}
                                        >
                                            Mark All Expired
                                        </button>
                                    </div>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-orange-700">
                                                <th className="text-left py-1 pr-4">Contract</th>
                                                <th className="text-left py-1 pr-4">Position</th>
                                                <th className="text-right py-1 pr-4">Qty</th>
                                                <th className="text-left py-1 pr-4">Expired</th>
                                                <th className="text-right py-1 pr-4">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {item.pendingExpiryLegs.map((leg, idx) => (
                                                <tr key={idx} className="border-t border-orange-200">
                                                    <td className="py-1 pr-4 font-medium">
                                                        {formatOptionDisplay(leg.symbol, 'option', leg.expiration_date)}
                                                    </td>
                                                    <td className="py-1 pr-4">
                                                        <span className={`px-2 py-0.5 rounded ${
                                                            leg.type === 'long'
                                                                ? 'bg-green-100 text-green-700'
                                                                : 'bg-red-100 text-red-700'
                                                        }`}>
                                                            {leg.type === 'long' ? 'Long (BTO)' : 'Short (STO)'}
                                                        </span>
                                                    </td>
                                                    <td className="text-right py-1 pr-4">{leg.quantity}</td>
                                                    <td className="py-1 pr-4">{formatDate(leg.expiration_date)}</td>
                                                    <td className="text-right py-1 pr-4">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                expireMutation.mutate(leg.tradeIds);
                                                            }}
                                                            className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                                                            disabled={expireMutation.isPending}
                                                        >
                                                            Mark Expired
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Already expired legs - showing P&L */}
                            {isStrategy && item.expiredLegs?.length > 0 && (
                                <div className="mt-4 p-3 bg-red-50 rounded border border-red-200">
                                    <div className="text-xs font-medium text-red-800 mb-2">
                                        Expired Worthless
                                    </div>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-red-700">
                                                <th className="text-left py-1 pr-4">Contract</th>
                                                <th className="text-left py-1 pr-4">Position</th>
                                                <th className="text-right py-1 pr-4">Qty</th>
                                                <th className="text-left py-1 pr-4">Expired</th>
                                                <th className="text-right py-1 pr-4">P&L Impact</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {item.expiredLegs.map((leg, idx) => (
                                                <tr key={idx} className="border-t border-red-200">
                                                    <td className="py-1 pr-4 font-medium">
                                                        {formatOptionDisplay(leg.symbol, 'option', leg.expiration_date)}
                                                    </td>
                                                    <td className="py-1 pr-4">
                                                        <span className={`px-2 py-0.5 rounded ${
                                                            leg.type === 'long'
                                                                ? 'bg-green-100 text-green-700'
                                                                : 'bg-red-100 text-red-700'
                                                        }`}>
                                                            {leg.type === 'long' ? 'Long (BTO)' : 'Short (STO)'}
                                                        </span>
                                                    </td>
                                                    <td className="text-right py-1 pr-4">{leg.quantity}</td>
                                                    <td className="py-1 pr-4">{formatDate(leg.expiration_date)}</td>
                                                    <td className={`text-right py-1 pr-4 font-medium ${
                                                        leg.pnlImpact >= 0 ? 'text-green-600' : 'text-red-600'
                                                    }`}>
                                                        {formatCurrency(leg.pnlImpact)}
                                                        <span className="text-gray-500 ml-1">
                                                            ({leg.type === 'long' ? 'lost' : 'kept'})
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </td>
                    </tr>
                )}
            </Fragment>
        );
    };

    return (
        <div>
            {/* Stats cards - dynamic based on filters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-gray-50 border-b">
                <div className="bg-white rounded-lg shadow-sm p-3">
                    <p className="text-gray-500 text-xs">Positions</p>
                    <p className="text-xl font-bold">{allItems.length}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-3">
                    <p className="text-gray-500 text-xs">Total Trades</p>
                    <p className="text-xl font-bold">{totalTrades}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-3">
                    <p className="text-gray-500 text-xs">Volume</p>
                    <p className="text-xl font-bold">{formatCurrency(totalVolume)}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-3">
                    <p className="text-gray-500 text-xs">Total P&L</p>
                    <p className={`text-xl font-bold ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(totalPnl)}
                    </p>
                </div>
            </div>

            {/* Strategies view header */}
            <div className="p-4 border-b">
                <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-gray-600">
                            Drag trades to baskets to create strategies
                        </p>
                        {strategies.length > 0 && (
                            <span className="text-sm text-purple-600 flex items-center gap-1">
                                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                                {strategies.length} strategies
                            </span>
                        )}
                        {topSymbol !== '-' && (
                            <span className="text-sm text-gray-500">
                                Top: <span className="font-medium text-gray-700">{topSymbol}</span>
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex gap-2">
                    <span className="text-sm text-gray-500 self-center">Status:</span>
                    {['all', 'closed', 'open', 'expired'].map(status => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-3 py-1 rounded text-sm capitalize ${
                                statusFilter === status
                                    ? status === 'expired' ? 'bg-red-600 text-white'
                                      : 'bg-blue-600 text-white'
                                    : 'bg-gray-100'
                            }`}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            </div>

            {/* Strategy baskets - collect trades before creating */}
            <div className="mx-4 my-3 space-y-3">
                {/* Basket controls */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Strategy Baskets</span>
                        <span className="text-xs text-gray-400">({baskets.filter(b => b.items.length > 0).length} with items)</span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={addNewBasket}
                            className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                        >
                            + Add Basket
                        </button>
                        {baskets.filter(b => b.items.length > 0).length > 1 && (
                            <button
                                onClick={createAllStrategies}
                                className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                            >
                                Create All Strategies
                            </button>
                        )}
                    </div>
                </div>

                {/* Individual baskets */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {baskets.map((basket) => {
                        const isHovering = hoverBasketId === basket.id;
                        const hasItems = basket.items.length > 0;

                        return (
                            <div
                                key={basket.id}
                                className={`border-2 border-dashed rounded-lg transition-all ${
                                    isHovering
                                        ? 'border-purple-500 bg-purple-100'
                                        : hasItems
                                            ? 'border-purple-300 bg-purple-50'
                                            : draggedItem
                                                ? 'border-gray-300 bg-gray-50'
                                                : 'border-gray-200'
                                } ${hasItems ? 'p-3' : ''}`}
                            >
                                {!hasItems ? (
                                    <div
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (draggedItem) setHoverBasketId(basket.id);
                                        }}
                                        onDragLeave={(e) => {
                                            e.stopPropagation();
                                            setHoverBasketId(null);
                                        }}
                                        onDrop={(e) => handleBasketDrop(e, basket.id)}
                                        className="flex flex-col items-center justify-center gap-1 text-sm py-4"
                                    >
                                        <svg
                                            className={`w-5 h-5 ${isHovering ? 'text-purple-500' : 'text-gray-400'}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                        </svg>
                                        <span className={isHovering ? 'text-purple-600 font-medium' : 'text-gray-500'}>
                                            {isHovering ? 'Drop here' : 'Empty basket'}
                                        </span>
                                        {baskets.length > 1 && (
                                            <button
                                                onClick={() => removeBasket(basket.id)}
                                                className="text-xs text-gray-400 hover:text-red-500 mt-1"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-1">
                                                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                                                <span className="text-xs text-purple-500">({basket.items.length})</span>
                                            </div>
                                            <button
                                                onClick={() => clearBasket(basket.id)}
                                                className="text-xs text-gray-400 hover:text-red-500"
                                            >
                                                Clear
                                            </button>
                                        </div>

                                        {/* Strategy name input */}
                                        <input
                                            type="text"
                                            value={basket.name}
                                            onChange={(e) => updateBasketName(basket.id, e.target.value)}
                                            placeholder="Strategy name"
                                            className="w-full px-2 py-1 mb-2 text-sm border border-purple-200 rounded focus:outline-none focus:border-purple-400"
                                        />

                                        {/* Basket items */}
                                        <div className="flex flex-wrap gap-1 mb-2">
                                            {basket.items.map((item, idx) => (
                                                <span
                                                    key={idx}
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-purple-200 rounded text-xs"
                                                >
                                                    {item.displayName}
                                                    <button
                                                        onClick={() => removeFromBasket(basket.id, idx)}
                                                        className="text-gray-400 hover:text-red-500"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </span>
                                            ))}
                                        </div>

                                        {/* Drop zone for adding more items */}
                                        <div
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (draggedItem) setHoverBasketId(basket.id);
                                            }}
                                            onDragLeave={(e) => {
                                                e.stopPropagation();
                                                setHoverBasketId(null);
                                            }}
                                            onDrop={(e) => handleBasketDrop(e, basket.id)}
                                            className={`text-center py-2 mb-2 border border-dashed rounded text-xs transition-all ${
                                                isHovering
                                                    ? 'border-purple-500 bg-purple-100 text-purple-600'
                                                    : 'border-purple-200 bg-white text-purple-400'
                                            }`}
                                        >
                                            + Drop more
                                        </div>

                                        {/* Create button */}
                                        <button
                                            onClick={() => createStrategyFromBasket(basket.id)}
                                            className="w-full py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 text-xs font-medium"
                                        >
                                            Create Strategy
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {isLoading ? (
                <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : sortedItems.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No positions found.</div>
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
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('buyTotal')}>
                                    Buy Total<SortIcon columnKey="buyTotal" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sellTotal')}>
                                    Sell Total<SortIcon columnKey="sellTotal" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('pnl')}>
                                    P&L<SortIcon columnKey="pnl" />
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('pnlPercent')}>
                                    %<SortIcon columnKey="pnlPercent" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('buyDate')}>
                                    Opened<SortIcon columnKey="buyDate" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sellDate')}>
                                    Closed<SortIcon columnKey="sellDate" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('expirationDate')}>
                                    Expiry<SortIcon columnKey="expirationDate" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>
                                    Status<SortIcon columnKey="status" />
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('broker')}>
                                    Broker<SortIcon columnKey="broker" />
                                </th>
                                <th className="px-4 py-3 text-center font-medium text-gray-600">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {sortedItems.map((item) => renderRow(item, item._key, item._isStrategy))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
