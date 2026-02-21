import { parseOptionSymbol, getDisplaySymbol } from './optionParser.js';

/**
 * Check if an option has expired based on stored expiration_date or symbol
 * @returns {object|null} { expired: boolean, expirationDate: Date } or null if not an option
 */
export function checkOptionExpiration(symbol, assetType, storedExpirationDate) {
    if (assetType !== 'option') return null;

    let expDate;

    // Use stored expiration date if available
    if (storedExpirationDate) {
        expDate = new Date(storedExpirationDate);
    } else {
        // Fall back to parsing from symbol
        const parsed = parseOptionSymbol(symbol);
        if (!parsed) return null;
        expDate = parsed.expiration;
    }

    const now = new Date();
    // Options expire at market close on expiration day, so compare dates only
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const expDateOnly = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());

    return {
        expired: expDateOnly < today,
        expirationDate: expDate,
    };
}

/**
 * Generate a grouping key for FIFO matching
 * For options: underlying_expiry_strike_type_option (e.g., "AAPL_2026-01-06_150_C_option")
 * For stocks/futures: symbol_asset_type (e.g., "AAPL_stock")
 */
export function getGroupingKey(trade) {
    if (trade.asset_type === 'option') {
        const parsed = parseOptionSymbol(trade.symbol);
        if (parsed) {
            // Format expiration as ISO date for consistent grouping
            const expDateStr = parsed.expiration.toISOString().split('T')[0];
            return `${parsed.underlying}_${expDateStr}_${parsed.strike}_${parsed.typeShort}_option`;
        }
    }
    // Fallback to symbol + asset_type for non-options or unparseable options
    return `${trade.symbol}_${trade.asset_type}`;
}

/**
 * Get parsed option info for display purposes
 */
export function getOptionInfo(trade) {
    if (trade.asset_type !== 'option') {
        return null;
    }
    const parsed = parseOptionSymbol(trade.symbol);
    if (!parsed) {
        return null;
    }
    return {
        underlying: parsed.underlying,
        expiry: parsed.expiration,
        strike: parsed.strike,
        type: parsed.type,
        typeShort: parsed.typeShort,
    };
}

/**
 * Get the aggregate review status from multiple trades
 * Returns the highest status: 0=none, 1=reviewing, 2=reviewed
 */
export function getReviewStatus(trades) {
    return Math.max(...trades.map(t => t.review || 0));
}

// Re-export getDisplaySymbol for convenience
export { getDisplaySymbol };
