/**
 * Parse option symbols into readable format
 * Supports formats:
 * - Webull: SPXW260107P06920000 -> SPX 1/7/26 $692 P
 * - Robinhood: Similar OCC format
 */

/**
 * Parse an OCC-style option symbol
 * Format: [UNDERLYING][YYMMDD][C/P][STRIKE]
 * Strike is in format DDDDDCCC (dollars * 1000)
 */
export function parseOptionSymbol(symbol) {
    if (!symbol || typeof symbol !== 'string') {
        return null;
    }

    // Match pattern: letters, then 6 digits (date), then C or P, then digits (strike)
    const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);

    if (!match) {
        return null;
    }

    const [, underlying, dateStr, type, strikeStr] = match;

    // Parse date (YYMMDD)
    const year = parseInt(dateStr.substring(0, 2)) + 2000;
    const month = parseInt(dateStr.substring(2, 4));
    const day = parseInt(dateStr.substring(4, 6));

    // Parse strike (last 8 digits = dollars * 1000, so divide by 1000)
    // e.g., 06920000 = $692.00
    const strike = parseInt(strikeStr) / 1000;

    // Clean up underlying (remove trailing W for weeklies, etc.)
    let cleanUnderlying = underlying;
    if (cleanUnderlying.endsWith('W')) {
        cleanUnderlying = cleanUnderlying.slice(0, -1);
    }

    return {
        underlying: cleanUnderlying,
        expiration: new Date(year, month - 1, day),
        type: type === 'C' ? 'Call' : 'Put',
        typeShort: type,
        strike,
        formatted: `${cleanUnderlying} ${month}/${day}/${year % 100} $${strike} ${type === 'C' ? 'C' : 'P'}`,
    };
}

/**
 * Get display symbol - returns base symbol for options, original for others
 */
export function getDisplaySymbol(symbol, assetType) {
    if (assetType === 'option') {
        const parsed = parseOptionSymbol(symbol);
        if (parsed) {
            return parsed.underlying;
        }
    }
    return symbol;
}

/**
 * Get the base symbol for matching trades (for grouping buy/sell)
 */
export function getBaseSymbol(symbol) {
    // For options, the full symbol is the base (same option contract)
    // For stocks, just the symbol
    return symbol;
}
