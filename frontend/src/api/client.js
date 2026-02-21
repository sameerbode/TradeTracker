const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

async function request(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        ...options,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
    }

    return response.json();
}

// Trades
export const getTrades = (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
            params.append(key, value);
        }
    });
    const query = params.toString();
    return request(`/trades${query ? `?${query}` : ''}`);
};

export const getSymbols = () => request('/trades/symbols');

export const getPositions = () => request('/trades/positions');

export const getRoundTripPositions = () => request('/trades/positions/roundtrip');

export const deleteTrade = (id) => request(`/trades/${id}`, { method: 'DELETE' });

export const clearAllTrades = () => request('/trades', { method: 'DELETE' });

export const toggleTradeReview = (id) => request(`/trades/${id}/review`, { method: 'PATCH' });

// status: 0=none, 1=reviewing, 2=reviewed
export const setTradesReview = (tradeIds, status) =>
    request('/trades/review', {
        method: 'PATCH',
        body: JSON.stringify({ tradeIds, status })
    });

export const expireTrades = (tradeIds) =>
    request('/trades/expire', {
        method: 'POST',
        body: JSON.stringify({ tradeIds })
    });

// Stats
export const getStats = () => request('/stats');

export const getDailyStats = (days = 30) => request(`/stats/daily?days=${days}`);

// Accounts
export const getAccounts = () => request('/accounts');

export const createAccount = (broker, nickname) =>
    request('/accounts', {
        method: 'POST',
        body: JSON.stringify({ broker, nickname }),
    });

export const deleteAccount = (id) => request(`/accounts/${id}`, { method: 'DELETE' });

// Import
export const importCsv = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/import/csv`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(error.error || 'Import failed');
    }

    return response.json();
};

export const importPdf = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/import/pdf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(error.error || 'Import failed');
    }

    return response.json();
};

export const getImportHistory = (limit = 20) => request(`/import/history?limit=${limit}`);

export const deleteImport = (id) => request(`/import/${id}`, { method: 'DELETE' });

// Export backup - triggers download
export const exportBackup = async () => {
    const response = await fetch(`${API_BASE}/import/export`);
    if (!response.ok) {
        throw new Error('Export failed');
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradetracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    return { success: true };
};

// Import backup
export const importBackup = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/import/backup`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(error.error || 'Import failed');
    }

    return response.json();
};

// Strategies
export const getStrategies = () => request('/strategies');

export const getGroupedTradeIds = () => request('/strategies/grouped-trades');

export const createStrategy = (name, tradeIds = [], notes = '') =>
    request('/strategies', {
        method: 'POST',
        body: JSON.stringify({ name, tradeIds, notes }),
    });

export const updateStrategy = (id, { name, notes }) =>
    request(`/strategies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, notes }),
    });

export const deleteStrategy = (id) =>
    request(`/strategies/${id}`, { method: 'DELETE' });

export const addTradesToStrategy = (strategyId, tradeIds) =>
    request(`/strategies/${strategyId}/trades`, {
        method: 'POST',
        body: JSON.stringify({ tradeIds }),
    });

export const removeTradesFromStrategy = (strategyId, tradeIds) =>
    request(`/strategies/${strategyId}/trades`, {
        method: 'DELETE',
        body: JSON.stringify({ tradeIds }),
    });

export const mergeStrategies = (strategyIds, name) =>
    request('/strategies/merge', {
        method: 'POST',
        body: JSON.stringify({ strategyIds, name }),
    });
