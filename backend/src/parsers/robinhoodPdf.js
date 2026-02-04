import pdf from 'pdf-parse';

/**
 * Parse Robinhood futures statement PDF
 * This parser extracts futures trades from monthly/daily statements
 *
 * Note: PDF parsing is inherently fragile. The exact format may vary
 * and this parser may need adjustments based on actual statement format.
 */
export async function parseRobinhoodFuturesPdf(pdfBuffer) {
    const data = await pdf(pdfBuffer);
    const text = data.text;

    const trades = [];
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

    // Look for futures trade patterns
    // Common futures symbols: /ES, /NQ, /MES, /MNQ, /CL, /GC, etc.
    const futuresPattern = /\/[A-Z]{1,4}\d{0,2}/;

    let inTradeSection = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect start of trades section
        if (line.toLowerCase().includes('trade') &&
            (line.toLowerCase().includes('activity') || line.toLowerCase().includes('history'))) {
            inTradeSection = true;
            continue;
        }

        // Look for lines containing futures symbols
        const symbolMatch = line.match(futuresPattern);
        if (!symbolMatch) continue;

        const symbol = symbolMatch[0];

        // Try to extract trade details from this and surrounding lines
        // Format varies but typically includes: Date, Symbol, Side, Qty, Price
        const combinedContext = lines.slice(Math.max(0, i - 2), i + 3).join(' ');

        // Extract side (buy/sell)
        const sideMatch = combinedContext.match(/\b(buy|sell|bought|sold)\b/i);
        const side = sideMatch ?
            (sideMatch[1].toLowerCase().startsWith('b') ? 'buy' : 'sell') : null;

        // Extract quantity
        const qtyMatch = combinedContext.match(/(\d+)\s*(contract|ct|qty)/i) ||
                         combinedContext.match(/qty[:\s]*(\d+)/i);
        const quantity = qtyMatch ? parseInt(qtyMatch[1]) : null;

        // Extract price
        const priceMatch = combinedContext.match(/\$?([\d,]+\.?\d*)\s*(per|@|price)/i) ||
                          combinedContext.match(/price[:\s]*\$?([\d,]+\.?\d*)/i) ||
                          combinedContext.match(/@\s*\$?([\d,]+\.?\d*)/i);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;

        // Extract date
        const dateMatch = combinedContext.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        const executedAt = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

        // Only add if we have minimum required fields
        if (symbol && side && quantity) {
            trades.push({
                broker_trade_id: `rh_fut_${executedAt}_${symbol}_${side}_${quantity}_${price || 0}`,
                symbol,
                asset_type: 'future',
                side,
                quantity,
                price: price || 0,
                total: (price || 0) * quantity,
                fees: 0,
                executed_at: executedAt,
            });
        }
    }

    return trades;
}

/**
 * Validate if buffer is a PDF
 */
export function isPdf(buffer) {
    // PDF files start with %PDF
    return buffer.slice(0, 4).toString() === '%PDF';
}
