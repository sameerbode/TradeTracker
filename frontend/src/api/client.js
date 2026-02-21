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

// Positions (unified - replaces old strategies + round-trip positions)
export const getPositions = () => request('/positions');

export const createPosition = (name, tradeIds = [], notes = '') =>
    request('/positions', {
        method: 'POST',
        body: JSON.stringify({ name, tradeIds, notes }),
    });

export const updatePosition = (id, { name, notes, why }) =>
    request(`/positions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, notes, why }),
    });

export const deletePosition = (id) =>
    request(`/positions/${id}`, { method: 'DELETE' });

export const addTradesToPosition = (positionId, tradeIds) =>
    request(`/positions/${positionId}/trades`, {
        method: 'POST',
        body: JSON.stringify({ tradeIds }),
    });

export const removeTradesFromPosition = (positionId, tradeIds) =>
    request(`/positions/${positionId}/trades`, {
        method: 'DELETE',
        body: JSON.stringify({ tradeIds }),
    });

export const ungroupPosition = (id) =>
    request(`/positions/${id}/ungroup`, { method: 'POST' });

export const mergePositions = (positionIds, name) =>
    request('/positions/merge', {
        method: 'POST',
        body: JSON.stringify({ positionIds, name }),
    });

export const recomputePositions = () =>
    request('/positions/recompute', { method: 'POST' });

export const getWhyOptions = () => request('/positions/why-options');

export const addWhyOption = ({ label, note }) =>
    request('/positions/why-options', {
        method: 'POST',
        body: JSON.stringify({ label, note }),
    });

export const updateWhyOption = (id, { label, note }) =>
    request(`/positions/why-options/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label, note }),
    });

export const deleteWhyOption = (id) =>
    request(`/positions/why-options/${id}`, {
        method: 'DELETE',
    });
