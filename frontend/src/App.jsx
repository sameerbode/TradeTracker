import { useState, useRef, useCallback, memo } from 'react';
import TradeTable from './components/TradeTable';
import PositionsTable from './components/PositionsTable';
import ImportButton from './components/ImportButton';
import FilterBar from './components/FilterBar';

// Isolated search input - re-renders only itself on keystroke
const SearchInput = memo(function SearchInput({ onSearch }) {
    const [value, setValue] = useState('');
    const debounceRef = useRef(null);

    const handleChange = (e) => {
        const v = e.target.value;
        setValue(v);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onSearch(v), 300);
    };

    const handleClear = () => {
        setValue('');
        clearTimeout(debounceRef.current);
        onSearch('');
    };

    return (
        <div className="relative">
            <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
                type="text"
                placeholder="Search symbol..."
                value={value}
                onChange={handleChange}
                className="pl-9 pr-8 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {value && (
                <button
                    onClick={handleClear}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </div>
    );
});

export default function App() {
    const [view, setView] = useState('positions');
    const [filters, setFilters] = useState({});
    const [search, setSearch] = useState('');

    const handleSearch = useCallback((value) => {
        setSearch(value);
    }, []);

    // Combine search with filters
    const combinedFilters = {
        ...filters,
        search: search || undefined,
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-sm">
                <div className="w-full px-4 py-4 flex justify-between items-center">
                    <h1 className="text-xl font-bold text-gray-900">TradeTracker</h1>
                    <ImportButton />
                </div>
            </header>

            <main className="w-full px-4 py-6">
                <div className="mb-4 flex gap-2 items-center flex-wrap">
                    <button
                        onClick={() => setView('positions')}
                        className={`px-4 py-2 rounded-lg font-medium ${
                            view === 'positions'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        Strategies
                    </button>
                    <button
                        onClick={() => setView('trades')}
                        className={`px-4 py-2 rounded-lg font-medium ${
                            view === 'trades'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        All Trades
                    </button>

                    <SearchInput onSearch={handleSearch} />

                    <div className="ml-auto">
                        <FilterBar filters={filters} onChange={setFilters} />
                    </div>
                </div>

                {view === 'positions' ? (
                    <PositionsTable filters={combinedFilters} />
                ) : (
                    <TradeTable filters={combinedFilters} />
                )}
            </main>

            <footer className="w-full px-4 py-6 text-center text-gray-500 text-sm">
                <p>Import CSV from Robinhood/Webull or PDF statements for futures trades</p>
            </footer>
        </div>
    );
}
