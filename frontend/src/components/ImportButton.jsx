import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importCsv, importPdf, importBackup, exportBackup, clearAllTrades } from '../api/client';

export default function ImportButton() {
    const queryClient = useQueryClient();
    const [results, setResults] = useState([]);
    const [processingCount, setProcessingCount] = useState(0);
    const fileInputRef = useRef(null);

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['trades'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
        queryClient.invalidateQueries({ queryKey: ['symbols'] });
        queryClient.invalidateQueries({ queryKey: ['strategies'] });
        queryClient.invalidateQueries({ queryKey: ['groupedTradeIds'] });
        queryClient.invalidateQueries({ queryKey: ['positions'] });
    };

    const clearMutation = useMutation({
        mutationFn: clearAllTrades,
        onSuccess: (data) => {
            setResults([{ cleared: data.deleted }]);
            invalidateAll();
        },
        onError: (error) => {
            setResults([{ error: error.message }]);
        },
    });

    const processFile = async (file) => {
        try {
            let data;
            if (file.name.toLowerCase().endsWith('.pdf')) {
                data = await importPdf(file);
            } else if (file.name.toLowerCase().endsWith('.csv')) {
                data = await importCsv(file);
            } else if (file.name.toLowerCase().endsWith('.json')) {
                data = await importBackup(file);
                return { filename: file.name, restored: data.restored };
            } else {
                return { filename: file.name, error: 'Invalid file type' };
            }
            return { filename: file.name, ...data };
        } catch (error) {
            return { filename: file.name, error: error.message };
        }
    };

    const handleDownload = async () => {
        try {
            setResults([{ downloading: true }]);
            await exportBackup();
            setResults([{ downloaded: true }]);
        } catch (error) {
            setResults([{ error: error.message }]);
        }
    };

    const handleClear = () => {
        if (window.confirm('Are you sure you want to delete ALL trades? This cannot be undone.')) {
            setResults([]);
            clearMutation.mutate();
        }
    };

    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setResults([]);
        setProcessingCount(files.length);

        const fileResults = [];
        for (const file of files) {
            const result = await processFile(file);
            fileResults.push(result);
            setResults([...fileResults]);
        }

        invalidateAll();
        setProcessingCount(0);

        // Reset input so same files can be selected again
        e.target.value = '';
    };

    const isLoading = processingCount > 0 || clearMutation.isPending;

    return (
        <div className="flex items-center gap-4">
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.pdf,.json"
                multiple
                onChange={handleFileChange}
                className="hidden"
            />
            <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
                {isLoading ? (
                    <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Importing...
                    </>
                ) : (
                    <>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Import Trades
                    </>
                )}
            </button>

            <button
                onClick={handleDownload}
                disabled={isLoading}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Backup
            </button>

            <button
                onClick={handleClear}
                disabled={isLoading}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear All
            </button>

            {results.length > 0 && (
                <div className="text-sm space-y-1">
                    {results.map((result, index) => (
                        <div key={index} className={result.error ? 'text-red-600' : result.downloading ? 'text-blue-600' : 'text-green-600'}>
                            {result.error ? (
                                <>{result.filename ? `${result.filename}: ` : ''}{result.error}</>
                            ) : result.cleared !== undefined ? (
                                <>Cleared {result.cleared} trades</>
                            ) : result.downloading ? (
                                <>Preparing download...</>
                            ) : result.downloaded ? (
                                <>Backup downloaded</>
                            ) : result.restored ? (
                                <>
                                    {result.filename}: Restored {result.restored.accounts} accounts, {result.restored.trades} trades, {result.restored.strategies} strategies
                                </>
                            ) : (
                                <>
                                    {result.filename}: Imported {result.trades_imported} trades
                                    {result.trades_skipped > 0 && ` (${result.trades_skipped} skipped)`}
                                </>
                            )}
                        </div>
                    ))}
                    {processingCount > results.length && (
                        <div className="text-gray-500">
                            Processing {processingCount - results.length} more file(s)...
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
