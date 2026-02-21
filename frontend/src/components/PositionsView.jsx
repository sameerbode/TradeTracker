import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, Fragment, useMemo, useEffect } from 'react';
import {
    getPositions,
    setTradesReview,
    expireTrades,
    createPosition,
    addTradesToPosition,
    deletePosition,
    updatePosition,
    ungroupPosition,
    getWhyOptions,
    addWhyOption,
    updateWhyOption,
    deleteWhyOption,
    getStats,
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

export default function PositionsView({ filters = {} }) {
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState('all');
    const [expandedRows, setExpandedRows] = useState(new Set());
    const [sortConfig, setSortConfig] = useState({ key: 'sellDate', direction: 'desc' });
    const [draggedItem, setDraggedItem] = useState(null);
    const [dropTarget, setDropTarget] = useState(null);
    const [hoverBasketId, setHoverBasketId] = useState(null);
    const [baskets, setBaskets] = useState([{ id: 1, name: '', items: [] }]);
    const [nextBasketId, setNextBasketId] = useState(2);
    const [editingPositionId, setEditingPositionId] = useState(null);
    const [editingName, setEditingName] = useState('');

    const [tallyOpen, setTallyOpen] = useState(false);

    useEffect(() => {
        if (!tallyOpen) return;
        const handleClick = () => setTallyOpen(false);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, [tallyOpen]);

    // Single query for ALL positions (both simple and multi-leg)
    const { data: positions = [], isLoading } = useQuery({
        queryKey: ['positions'],
        queryFn: getPositions,
    });

    const { data: stats } = useQuery({
        queryKey: ['stats'],
        queryFn: getStats,
    });

    const invalidatePositions = () => {
        queryClient.invalidateQueries({ queryKey: ['positions'] });
    };

    // Mutations
    const reviewMutation = useMutation({
        mutationFn: ({ tradeIds, status }) => setTradesReview(tradeIds, status),
        onMutate: async ({ tradeIds, status }) => {
            await queryClient.cancelQueries({ queryKey: ['positions'] });
            const prev = queryClient.getQueryData(['positions']);
            const tradeIdSet = new Set(tradeIds);
            queryClient.setQueryData(['positions'], old =>
                old?.map(p => p.tradeIds?.some(id => tradeIdSet.has(id)) ? { ...p, reviewStatus: status } : p)
            );
            return { prev };
        },
        onError: (_err, _vars, context) => {
            queryClient.setQueryData(['positions'], context.prev);
        },
        onSettled: invalidatePositions,
    });

    const expireMutation = useMutation({
        mutationFn: (tradeIds) => expireTrades(tradeIds),
        onSuccess: invalidatePositions,
    });

    const createPositionMutation = useMutation({
        mutationFn: ({ name, tradeIds }) => createPosition(name, tradeIds),
        onSuccess: invalidatePositions,
    });

    const addToPositionMutation = useMutation({
        mutationFn: ({ positionId, tradeIds }) => addTradesToPosition(positionId, tradeIds),
        onSuccess: invalidatePositions,
    });

    const deletePositionMutation = useMutation({
        mutationFn: deletePosition,
        onSuccess: invalidatePositions,
    });

    const ungroupPositionMutation = useMutation({
        mutationFn: ungroupPosition,
        onSuccess: invalidatePositions,
    });

    const updatePositionMutation = useMutation({
        mutationFn: ({ id, name, why }) => updatePosition(id, { name, why }),
        onSuccess: () => {
            invalidatePositions();
            setEditingPositionId(null);
        },
    });

    // Why options
    const { data: whyOptions = [] } = useQuery({
        queryKey: ['whyOptions'],
        queryFn: getWhyOptions,
    });

    const addWhyOptionMutation = useMutation({
        mutationFn: addWhyOption,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['whyOptions'] });
        },
    });

    const updateWhyOptionMutation = useMutation({
        mutationFn: ({ id, label, note }) => updateWhyOption(id, { label, note }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['whyOptions'] });
        },
    });

    const deleteWhyOptionMutation = useMutation({
        mutationFn: deleteWhyOption,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['whyOptions'] });
        },
    });

    // Why modal state
    const [whyModal, setWhyModal] = useState(null);
    const [whyModalName, setWhyModalName] = useState('');
    const [whyModalNote, setWhyModalNote] = useState('');

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

    // Drag handlers
    const handleDragStart = (e, item, type) => {
        setDraggedItem({ ...item, type });
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
    };

    const handleDragOver = (e, target) => {
        e.preventDefault();
        e.stopPropagation();
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

        const draggedTradeIds = draggedItem.type === 'trade'
            ? [draggedItem.tradeId]
            : (draggedItem.tradeIds || []);

        if (target.type === 'multileg') {
            // Drop onto existing multi-leg position
            addToPositionMutation.mutate({
                positionId: target.id,
                tradeIds: draggedTradeIds,
            });
        } else if (target.type === 'position' || target.type === 'trade') {
            // Drop onto position or trade - create new grouped position
            const targetTradeIds = target.type === 'trade'
                ? [target.tradeId]
                : (target.tradeIds || []);
            const allTradeIds = [...new Set([...draggedTradeIds, ...targetTradeIds])];

            const draggedLabel = draggedItem.optionDisplay || draggedItem.displaySymbol || draggedItem.name || 'Trade';
            const targetLabel = target.optionDisplay || target.displaySymbol || 'Trade';
            const name = `${draggedLabel} + ${targetLabel}`;

            createPositionMutation.mutate({ name, tradeIds: allTradeIds });
        }

        setDraggedItem(null);
    };

    const handleDragEnd = (e) => {
        e.stopPropagation();
        setDraggedItem(null);
        setDropTarget(null);
    };

    const handleBasketDrop = (e, basketId) => {
        e.preventDefault();
        e.stopPropagation();
        setHoverBasketId(null);

        if (!draggedItem) return;

        const draggedTradeIds = draggedItem.type === 'trade'
            ? [draggedItem.tradeId]
            : (draggedItem.tradeIds || []);

        const displayName = draggedItem.optionDisplay || draggedItem.displaySymbol || draggedItem.name || 'Trade';

        setBaskets(prev => {
            const allExistingIds = new Set(prev.flatMap(b => b.items.flatMap(item => item.tradeIds)));
            const newIds = draggedTradeIds.filter(id => !allExistingIds.has(id));
            if (newIds.length === 0) return prev;

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

    const createPositionFromBasket = (basketId) => {
        const basket = baskets.find(b => b.id === basketId);
        if (!basket || basket.items.length === 0) return;

        const allTradeIds = basket.items.flatMap(item => item.tradeIds);
        const name = basket.name.trim() || basket.items.map(item => item.displayName).join(' + ');

        createPositionMutation.mutate({ name, tradeIds: allTradeIds });
        removeBasket(basketId);
    };

    const createAllPositions = () => {
        const nonEmptyBaskets = baskets.filter(b => b.items.length > 0);
        if (nonEmptyBaskets.length === 0) return;

        nonEmptyBaskets.forEach(basket => {
            const allTradeIds = basket.items.flatMap(item => item.tradeIds);
            const name = basket.name.trim() || basket.items.map(item => item.displayName).join(' + ');
            createPositionMutation.mutate({ name, tradeIds: allTradeIds });
        });

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
            const searchUpper = filters.search.toUpperCase();
            const getBase = (s) => s?.replace(/\d.*$/, '').replace(/W$/, '').toUpperCase();
            const match = getBase(p.symbol) === searchUpper ||
                          getBase(p.displaySymbol) === searchUpper ||
                          p.name?.toUpperCase() === searchUpper ||
                          p.symbols?.some(s => getBase(s) === searchUpper);
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

    const { sortedItems, allItems, totalPnl, totalVolume, totalTrades, topSymbol, simpleCount, multiLegCount, reviewCounts } = useMemo(() => {
        const filtered = applyFilters(positions);

        const allItems = filtered.map((pos) => ({
            ...pos,
            _key: `pos-${pos.id}`,
        }));
        const sortedItems = sortItems(allItems);

        const totalPnl = allItems.reduce((sum, p) => sum + (p.pnl || 0), 0);
        const totalVolume = allItems.reduce((sum, p) => sum + (p.totalBuy || 0) + (p.totalSell || 0), 0);
        const totalTrades = allItems.reduce((sum, p) => sum + (p.trades?.length || p.legs || 0), 0);
        const simpleCount = allItems.filter(p => !p.isMultiLeg).length;
        const multiLegCount = allItems.filter(p => p.isMultiLeg).length;

        const reviewCounts = {
            notReviewed: allItems.filter(p => !p.reviewStatus || p.reviewStatus === 0).length,
            reviewing: allItems.filter(p => p.reviewStatus === 1).length,
            reviewed: allItems.filter(p => p.reviewStatus === 2).length,
        };

        const symbolCounts = {};
        allItems.forEach(p => {
            const symbols = p.symbols || [p.displaySymbol || p.symbol];
            symbols.forEach(s => {
                if (s) symbolCounts[s] = (symbolCounts[s] || 0) + 1;
            });
        });
        const topSymbol = Object.entries(symbolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

        return { sortedItems, allItems, totalPnl, totalVolume, totalTrades, topSymbol, simpleCount, multiLegCount, reviewCounts };
    }, [positions, statusFilter, filters, sortConfig]);

    // Tally: check all trades are accounted for (always uses unfiltered positions)
    const tally = useMemo(() => {
        if (!stats) return null;
        const dbTotal = stats.total_trades;
        const accountedFor = new Set(positions.flatMap(p => p.tradeIds || [])).size;
        const orphaned = dbTotal - accountedFor;
        const healthy = orphaned === 0;
        const simpleAll = positions.filter(p => !p.isMultiLeg).length;
        const multiLegAll = positions.filter(p => p.isMultiLeg).length;
        // Count trades in each category
        const simpleTradeIds = new Set(positions.filter(p => !p.isMultiLeg).flatMap(p => p.tradeIds || []));
        const multiLegTradeIds = new Set(positions.filter(p => p.isMultiLeg).flatMap(p => p.tradeIds || []));
        return {
            dbTotal,
            accountedFor,
            orphaned,
            healthy,
            simple: simpleAll,
            simpleTrades: simpleTradeIds.size,
            multiLeg: multiLegAll,
            multiLegTrades: multiLegTradeIds.size,
        };
    }, [stats, positions]);

    // Render row for all positions (simple and multi-leg)
    const renderRow = (item, key) => {
        const isExpanded = expandedRows.has(key);
        const isDragging = draggedItem?.key === key;
        const isDropping = dropTarget?.key === key;
        const isMultiLeg = item.isMultiLeg;

        return (
            <Fragment key={key}>
                <tr
                    draggable
                    onDragStart={(e) => handleDragStart(e, { ...item, key }, isMultiLeg ? 'multileg' : 'position')}
                    onDragOver={(e) => handleDragOver(e, { ...item, key, type: isMultiLeg ? 'multileg' : 'position' })}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, { ...item, key, type: isMultiLeg ? 'multileg' : 'position' })}
                    onDragEnd={handleDragEnd}
                    onClick={() => toggleRow(key)}
                    className={`cursor-pointer transition-all ${
                        isMultiLeg ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-gray-50'
                    } ${isDragging ? 'opacity-50' : ''} ${
                        isDropping ? 'ring-2 ring-purple-500 ring-inset bg-purple-100' : ''
                    }`}
                >
                    <td className="px-2 py-2 font-medium">
                        <span className="flex items-center gap-1">
                            {isMultiLeg && (
                                <span className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0" title="Multi-leg position"></span>
                            )}
                            <svg
                                className={`h-3 w-3 transition-transform text-gray-400 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            {isMultiLeg ? (
                                editingPositionId === item.id ? (
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onBlur={() => {
                                            if (editingName.trim()) {
                                                updatePositionMutation.mutate({ id: item.id, name: editingName });
                                            }
                                            setEditingPositionId(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') e.target.blur();
                                            if (e.key === 'Escape') setEditingPositionId(null);
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
                                            setEditingPositionId(item.id);
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
                            {isMultiLeg && (
                                <span className="text-xs text-purple-600">({item.legs} legs)</span>
                            )}
                            {isMultiLeg && item.hasExpiredLegs && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded" title="Some legs expired">
                                    {item.expiredLegs?.length} expired
                                </span>
                            )}
                        </span>
                    </td>
                    <td className="px-2 py-2">
                        {isMultiLeg ? (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700">multi-leg</span>
                        ) : (
                            <span className={`px-1.5 py-0.5 rounded text-xs ${
                                item.asset_type === 'future' ? 'bg-purple-100 text-purple-700' :
                                item.asset_type === 'option' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                            }`}>
                                {item.asset_type}
                            </span>
                        )}
                    </td>
                    <td className="px-2 py-2 text-right">{isMultiLeg ? '-' : item.quantity}</td>
                    <td className="px-2 py-2 text-right">{formatCurrency(item.totalBuy)}</td>
                    <td className="px-2 py-2 text-right">{formatCurrency(item.totalSell)}</td>
                    <td className={`px-2 py-2 text-right font-medium ${
                        item.pnl === null ? 'text-gray-400' :
                        item.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                        {formatCurrency(item.pnl)}
                    </td>
                    <td className={`px-2 py-2 text-right ${
                        item.pnlPercent === null ? 'text-gray-400' :
                        item.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                        {formatPercent(item.pnlPercent)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(item.buyDate)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(item.sellDate)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                        {!isMultiLeg && item.asset_type === 'option' ? formatDate(item.expirationDate) : '-'}
                    </td>
                    <td className="px-2 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                            item.status === 'open' ? 'bg-yellow-100 text-yellow-700' :
                            item.status === 'pending_expiry' ? 'bg-orange-100 text-orange-700' :
                            item.status === 'expired' ? 'bg-red-100 text-red-700' :
                            'bg-green-100 text-green-700'
                        }`}>
                            {item.status === 'pending_expiry' ? 'action' : item.status}
                        </span>
                    </td>
                    <td className="px-2 py-2 capitalize">{isMultiLeg ? '-' : item.broker}</td>
                    <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                            <select
                                value={item.why || ''}
                                onChange={(e) => {
                                    e.stopPropagation();
                                    const val = e.target.value;
                                    if (val === '__add__') {
                                        setWhyModalName('');
                                        setWhyModalNote('');
                                        setWhyModal({ mode: 'add', positionId: item.id });
                                        e.target.value = item.why || '';
                                        return;
                                    }
                                    updatePositionMutation.mutate({ id: item.id, why: val || null });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="px-2 py-1 text-xs border rounded bg-white"
                            >
                                <option value="">Select...</option>
                                {whyOptions.map((opt) => (
                                    <option key={opt.id} value={opt.label}>{opt.label}</option>
                                ))}
                                <option value="__add__">+ Add new...</option>
                            </select>
                            {item.why && whyOptions.find(o => o.label === item.why) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const opt = whyOptions.find(o => o.label === item.why);
                                        setWhyModalName(opt.label);
                                        setWhyModalNote(opt.note || '');
                                        setWhyModal({ mode: 'edit', option: opt, positionId: item.id });
                                    }}
                                    className="text-gray-400 hover:text-purple-600 transition-colors"
                                    title="View / edit reason"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </td>
                    <td className="px-2 py-2 text-center">
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
                            {isMultiLeg && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Ungroup this position?')) {
                                            ungroupPositionMutation.mutate(item.id);
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
                    <tr className={isMultiLeg ? 'bg-purple-50' : 'bg-gray-50'}>
                        <td colSpan={14} className="px-4 py-2">
                            <div className="text-xs text-gray-600 mb-2 font-medium">
                                {isMultiLeg ? 'Position Trades' : 'Trades'} - Drag individual trades to group
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
                                        <th className="text-left py-1 pr-4">Date</th>
                                        <th className="text-left py-1">Broker</th>
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
                                                <td className="py-1 pr-4">
                                                    {new Date(trade.executed_at).toLocaleString('en-US', {
                                                        month: 'numeric',
                                                        day: 'numeric',
                                                        year: '2-digit',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </td>
                                                <td className="py-1 capitalize">{trade.broker}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Pending expiry legs - need action */}
                            {isMultiLeg && item.pendingExpiryLegs?.length > 0 && (
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
                            {isMultiLeg && item.expiredLegs?.length > 0 && (
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
            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-gray-50 border-b">
                <div className="bg-white rounded-lg shadow-sm p-3 relative">
                    <div className="flex items-center gap-1.5">
                        <p className="text-gray-500 text-xs">Positions</p>
                        {tally && (
                            <div className="relative">
                                <button
                                    onClick={() => setTallyOpen(!tallyOpen)}
                                    className={`w-2.5 h-2.5 rounded-full ${tally.healthy ? 'bg-green-500' : 'bg-red-500'} hover:ring-2 hover:ring-offset-1 ${tally.healthy ? 'hover:ring-green-300' : 'hover:ring-red-300'} transition-all cursor-pointer`}
                                    title={tally.healthy ? 'All trades accounted for' : `${tally.orphaned} orphaned trades`}
                                />
                                {tallyOpen && (
                                    <div
                                        className="absolute top-5 left-0 z-50 bg-white border rounded-lg shadow-xl p-4 w-56"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between mb-3">
                                            <p className="text-xs font-semibold text-gray-700">Trade Tally</p>
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${tally.healthy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {tally.healthy ? 'Healthy' : 'Mismatch'}
                                            </span>
                                        </div>
                                        <div className="space-y-1.5 text-xs">
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">DB Trades</span>
                                                <span className="font-medium">{tally.dbTotal}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">In simple ({tally.simple} pos)</span>
                                                <span className="font-medium">{tally.simpleTrades}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">In multi-leg ({tally.multiLeg} pos)</span>
                                                <span className="font-medium">{tally.multiLegTrades}</span>
                                            </div>
                                            <div className="border-t pt-1.5 flex justify-between">
                                                <span className="text-gray-500">Accounted for</span>
                                                <span className="font-medium">{tally.accountedFor}</span>
                                            </div>
                                            {tally.orphaned !== 0 && (
                                                <div className="flex justify-between text-red-600">
                                                    <span>Orphaned</span>
                                                    <span className="font-medium">{tally.orphaned}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <p className="text-xl font-bold">{allItems.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                        {simpleCount} simple &middot; {multiLegCount} multi-leg
                    </p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-3">
                    <p className="text-gray-500 text-xs">Total Trades</p>
                    <p className="text-xl font-bold">{totalTrades}</p>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-green-600">{reviewCounts.reviewed} reviewed</span>
                        <span className="text-xs text-orange-500">{reviewCounts.reviewing} reviewing</span>
                        <span className="text-xs text-gray-400">{reviewCounts.notReviewed} pending</span>
                    </div>
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
                <div className="bg-white rounded-lg shadow-sm p-3">
                    <p className="text-gray-500 text-xs">Top Symbol</p>
                    <p className="text-xl font-bold">{topSymbol}</p>
                </div>
            </div>

            {/* Header */}
            <div className="p-4 border-b">
                <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-gray-600">
                            Drag trades to baskets to create grouped positions
                        </p>
                        {multiLegCount > 0 && (
                            <span className="text-sm text-purple-600 flex items-center gap-1">
                                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                                {multiLegCount} multi-leg
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

            {/* Baskets */}
            <div className="mx-4 my-3 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Position Baskets</span>
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
                                onClick={createAllPositions}
                                className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                            >
                                Create All Positions
                            </button>
                        )}
                    </div>
                </div>

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

                                        <input
                                            type="text"
                                            value={basket.name}
                                            onChange={(e) => updateBasketName(basket.id, e.target.value)}
                                            placeholder="Position name"
                                            className="w-full px-2 py-1 mb-2 text-sm border border-purple-200 rounded focus:outline-none focus:border-purple-400"
                                        />

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

                                        <button
                                            onClick={() => createPositionFromBasket(basket.id)}
                                            className="w-full py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 text-xs font-medium"
                                        >
                                            Create Position
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
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('displaySymbol')}>
                                    Symbol<SortIcon columnKey="displaySymbol" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('asset_type')}>
                                    Type<SortIcon columnKey="asset_type" />
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('quantity')}>
                                    Qty<SortIcon columnKey="quantity" />
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('totalBuy')}>
                                    Buy<SortIcon columnKey="totalBuy" />
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('totalSell')}>
                                    Sell<SortIcon columnKey="totalSell" />
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('pnl')}>
                                    P&L<SortIcon columnKey="pnl" />
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('pnlPercent')}>
                                    %<SortIcon columnKey="pnlPercent" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('buyDate')}>
                                    Open<SortIcon columnKey="buyDate" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sellDate')}>
                                    Close<SortIcon columnKey="sellDate" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('expirationDate')}>
                                    Exp<SortIcon columnKey="expirationDate" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>
                                    Status<SortIcon columnKey="status" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('broker')}>
                                    Broker<SortIcon columnKey="broker" />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600">Why</th>
                                <th className="px-2 py-2 text-center font-medium text-gray-600">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {sortedItems.map((item) => renderRow(item, item._key))}
                        </tbody>
                    </table>
                </div>
            )}
            {/* Why Option Modal */}
            {whyModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center"
                    onClick={() => setWhyModal(null)}
                >
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
                            <h3 className="text-lg font-semibold text-white">
                                {whyModal.mode === 'add' ? 'New Position Reason' : 'Position Reason'}
                            </h3>
                            <p className="text-purple-200 text-sm mt-0.5">
                                {whyModal.mode === 'add' ? 'Add a new reason for your trade' : 'View or edit this reason'}
                            </p>
                        </div>

                        <div className="px-6 py-5 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
                                <input
                                    type="text"
                                    value={whyModalName}
                                    onChange={(e) => setWhyModalName(e.target.value)}
                                    placeholder="e.g. Earnings Play, Momentum, Hedge..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                                <textarea
                                    value={whyModalNote}
                                    onChange={(e) => setWhyModalNote(e.target.value)}
                                    placeholder="Describe the strategy rationale..."
                                    rows={3}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all resize-none"
                                />
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-gray-50 flex items-center justify-between border-t">
                            <div>
                                {whyModal.mode === 'edit' && (
                                    <button
                                        onClick={() => {
                                            deleteWhyOptionMutation.mutate(whyModal.option.id);
                                            if (whyModal.positionId) {
                                                updatePositionMutation.mutate({ id: whyModal.positionId, why: null });
                                            }
                                            setWhyModal(null);
                                        }}
                                        className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setWhyModal(null)}
                                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        if (!whyModalName.trim()) return;
                                        if (whyModal.mode === 'add') {
                                            addWhyOptionMutation.mutate({ label: whyModalName.trim(), note: whyModalNote.trim() || null });
                                            if (whyModal.positionId) {
                                                updatePositionMutation.mutate({ id: whyModal.positionId, why: whyModalName.trim() });
                                            }
                                        } else {
                                            updateWhyOptionMutation.mutate({
                                                id: whyModal.option.id,
                                                label: whyModalName.trim(),
                                                note: whyModalNote.trim() || null,
                                            });
                                            if (whyModal.positionId) {
                                                updatePositionMutation.mutate({ id: whyModal.positionId, why: whyModalName.trim() });
                                            }
                                        }
                                        setWhyModal(null);
                                    }}
                                    disabled={!whyModalName.trim()}
                                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
