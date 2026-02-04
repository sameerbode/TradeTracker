import Papa from 'papaparse';

/**
 * Parse option details from Robinhood description field
 * Examples:
 *   "RTX 3/20/2026 Call $185.00" (Robinhood format: SYMBOL DATE CALL/PUT $STRIKE)
 *   "AAPL $150 Call 1/19/24" (alternate format)
 * Returns { strike, type, expirationDate } or null
 */
function parseOptionDescription(description) {
    if (!description) return null;

    // Format 1: "RTX 3/20/2026 Call $185.00" (DATE CALL/PUT $STRIKE)
    let match = description.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(call|put)\s+\$(\d+(?:\.\d+)?)/i);
    if (match) {
        const [, month, day, yearStr, type, strikeStr] = match;
        const strike = parseFloat(strikeStr);
        const year = yearStr.length === 2 ? 2000 + parseInt(yearStr) : parseInt(yearStr);
        return {
            strike,
            type: type.toLowerCase() === 'call' ? 'C' : 'P',
            expirationDate: new Date(year, parseInt(month) - 1, parseInt(day)),
        };
    }

    // Format 2: "$150 Call 1/19/24" ($STRIKE CALL/PUT DATE)
    match = description.match(/\$(\d+(?:\.\d+)?)\s+(call|put)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
    if (match) {
        const [, strikeStr, type, month, day, yearStr] = match;
        const strike = parseFloat(strikeStr);
        const year = yearStr.length === 2 ? 2000 + parseInt(yearStr) : parseInt(yearStr);
        return {
            strike,
            type: type.toLowerCase() === 'call' ? 'C' : 'P',
            expirationDate: new Date(year, parseInt(month) - 1, parseInt(day)),
        };
    }

    return null;
}

/**
 * Build OCC-style option symbol from components
 * @param {string} baseSymbol - e.g., "AAPL"
 * @param {Date} expDate - expiration date
 * @param {string} type - "C" or "P"
 * @param {number} strike - e.g., 150
 */
function buildOccSymbol(baseSymbol, expDate, type, strike) {
    const yy = String(expDate.getFullYear()).slice(-2);
    const mm = String(expDate.getMonth() + 1).padStart(2, '0');
    const dd = String(expDate.getDate()).padStart(2, '0');
    const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
    return `${baseSymbol}${yy}${mm}${dd}${type}${strikeStr}`;
}

/**
 * Parse Robinhood CSV export
 * Expected columns: Activity Date, Process Date, Settle Date, Instrument,
 * Description, Trans Code, Quantity, Price, Amount
 */
export function parseRobinhoodCsv(csvContent) {
    const result = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
    });

    // Only throw on critical errors, ignore field count mismatches
    const criticalErrors = result.errors.filter(
        (e) => e.type !== 'FieldMismatch'
    );
    if (criticalErrors.length > 0) {
        throw new Error(`CSV parsing error: ${criticalErrors[0].message}`);
    }

    const trades = [];
    let rowIndex = 0;

    for (const row of result.data) {
        rowIndex++;
        // Skip non-trade rows (deposits, dividends, etc.)
        const transCode = row['Trans Code']?.toUpperCase() || '';

        // Map transaction codes to buy/sell
        // BUY, BTO (Buy to Open), BTC (Buy to Close) = buy
        // SELL, STO (Sell to Open), STC (Sell to Close) = sell
        let side;
        if (['BUY', 'BTO', 'BTC'].includes(transCode)) {
            side = 'buy';
        } else if (['SELL', 'STO', 'STC'].includes(transCode)) {
            side = 'sell';
        } else {
            continue; // Skip non-trade rows
        }

        const instrument = row['Instrument']?.trim();
        const quantity = parseFloat(row['Quantity']) || 0;
        const price = parseFloat(row['Price']?.replace('$', '').replace(',', '')) || 0;
        const total = parseFloat(row['Amount']?.replace('$', '').replace(',', '').replace('(', '-').replace(')', '')) || 0;
        const executedAt = row['Activity Date'] || row['Process Date'];
        const description = row['Description'] || '';

        if (!instrument || quantity === 0) {
            continue;
        }

        // Determine asset type
        const descLower = description.toLowerCase();
        let assetType = 'stock';
        let symbol = instrument;

        // Check if instrument is already OCC format
        const isOccFormat = /\d{6}[CP]\d+$/.test(instrument);

        // Method 1: Options-specific transaction codes
        if (['BTO', 'BTC', 'STO', 'STC'].includes(transCode)) {
            assetType = 'option';
        }
        // Method 2: OCC option symbol pattern (e.g., SPXW260107P06920000)
        else if (isOccFormat) {
            assetType = 'option';
        }
        // Method 3: Description contains call/put as whole words
        else if (/\bcall\b/i.test(descLower) || /\bput\b/i.test(descLower)) {
            assetType = 'option';
        }

        // For options, determine the proper symbol and expiration date
        let expirationDate = null;
        if (assetType === 'option') {
            if (isOccFormat) {
                // Instrument is already OCC format - parse expiration from it
                symbol = instrument;
                const occMatch = instrument.match(/^[A-Z]+(\d{2})(\d{2})(\d{2})[CP]\d+$/);
                if (occMatch) {
                    const [, yy, mm, dd] = occMatch;
                    expirationDate = new Date(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd)).toISOString();
                }
            } else {
                // Instrument is base symbol - try to parse from description
                const optionInfo = parseOptionDescription(description);
                if (optionInfo) {
                    // Build OCC symbol and store expiration date
                    symbol = buildOccSymbol(instrument, optionInfo.expirationDate, optionInfo.type, optionInfo.strike);
                    expirationDate = optionInfo.expirationDate.toISOString();
                } else {
                    // Can't parse description - just use instrument as symbol
                    symbol = instrument;
                }
            }
        }

        trades.push({
            broker_trade_id: `rh_${executedAt}_${instrument}_${transCode}_${quantity}_${price}_${rowIndex}`,
            symbol,
            asset_type: assetType,
            side,
            quantity: Math.abs(quantity),
            price,
            total: Math.abs(total),
            fees: 0,
            executed_at: new Date(executedAt).toISOString(),
            expiration_date: expirationDate,
        });
    }

    return trades;
}

/**
 * Detect if content is a Robinhood CSV
 */
export function isRobinhoodCsv(csvContent) {
    const firstLine = csvContent.split('\n')[0].toLowerCase();
    return firstLine.includes('activity date') &&
           firstLine.includes('instrument') &&
           firstLine.includes('trans code');
}
