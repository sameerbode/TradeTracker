import Papa from 'papaparse';

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
 * Parse Webull CSV export
 * Expected columns vary but typically include: Symbol, Side, Qty, Price,
 * Filled Time, Status, Order Type, etc.
 */
export function parseWebullCsv(csvContent) {
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
        // Only process filled orders
        const status = row['Status']?.toLowerCase() || '';
        if (status && status !== 'filled') {
            continue;
        }

        const symbol = row['Symbol']?.trim();
        const side = row['Side']?.toLowerCase() || '';

        if (!symbol || !['buy', 'sell'].includes(side)) {
            continue;
        }

        const quantity = parseFloat(row['Filled'] || row['Total Qty'] || row['Qty'] || row['Quantity']) || 0;
        const price = parseFloat(
            (row['Avg Price'] || row['Price'] || '')
                .replace('@', '')
                .replace('$', '')
                .replace(',', '')
        ) || 0;
        const rawTotal = parseFloat(
            (row['Total'] || '')
                .replace('$', '')
                .replace(',', '')
                .replace('(', '-')
                .replace(')', '')
        ) || 0;
        const executedAt = row['Filled Time'] || row['Time'] || row['Create Time'] || row['Placed Time'];

        if (quantity === 0) {
            continue;
        }

        // Determine asset type
        let assetType = 'stock';
        let finalSymbol = symbol;
        const optionType = row['Option Type']?.toLowerCase() || '';

        // Webull encodes options in symbol: e.g., SPXW260107P06920000
        // Pattern: [UNDERLYING][YYMMDD][C or P][STRIKE]
        const optionPattern = /\d{6}[CP]\d+$/;
        const isOccFormat = optionPattern.test(symbol);

        // Check for option indicators
        if (optionType.includes('call') || optionType.includes('put') ||
            row['Strike Price'] || row['Expiration Date']) {
            assetType = 'option';
        }

        if (isOccFormat) {
            assetType = 'option';
        }

        // Webull futures typically have / prefix
        if (symbol.startsWith('/')) {
            assetType = 'future';
        }

        // For options, ensure we have OCC format symbol and expiration date
        let expirationDate = null;
        if (assetType === 'option') {
            if (isOccFormat) {
                // Parse expiration from OCC symbol
                const occMatch = symbol.match(/^[A-Z]+(\d{2})(\d{2})(\d{2})[CP]\d+$/);
                if (occMatch) {
                    const [, yy, mm, dd] = occMatch;
                    expirationDate = new Date(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd)).toISOString();
                }
            } else {
                // Try to build OCC symbol from separate columns
                const strikePrice = parseFloat(row['Strike Price']?.replace('$', '').replace(',', '')) || 0;
                const expDateStr = row['Expiration Date'] || row['Exp Date'] || '';
                const callPut = optionType.includes('call') ? 'C' : optionType.includes('put') ? 'P' : null;

                if (strikePrice && expDateStr && callPut) {
                    const expDate = new Date(expDateStr);
                    if (!isNaN(expDate.getTime())) {
                        finalSymbol = buildOccSymbol(symbol, expDate, callPut, strikePrice);
                        expirationDate = expDate.toISOString();
                    }
                }
            }
        }

        // Calculate total: use CSV value if present, otherwise compute it
        // Options contracts represent 100 shares, so multiply by 100
        const multiplier = assetType === 'option' ? 100 : 1;
        const total = rawTotal || (quantity * price * multiplier);

        trades.push({
            broker_trade_id: `wb_${executedAt}_${symbol}_${side}_${quantity}_${price}_${rowIndex}`,
            symbol: finalSymbol,
            asset_type: assetType,
            side,
            quantity: Math.abs(quantity),
            price,
            total: Math.abs(total),
            fees: parseFloat(row['Commission']?.replace('$', '') || 0),
            executed_at: new Date(executedAt).toISOString(),
            expiration_date: expirationDate,
        });
    }

    return trades;
}

/**
 * Detect if content is a Webull CSV
 */
export function isWebullCsv(csvContent) {
    const firstLine = csvContent.split('\n')[0].toLowerCase();
    return (firstLine.includes('symbol') && firstLine.includes('side')) ||
           (firstLine.includes('filled time'));
}
