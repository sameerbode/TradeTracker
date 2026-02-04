import StrategiesView from './StrategiesView';

export default function PositionsTable({ filters = {} }) {
    return (
        <div className="bg-white rounded-lg shadow">
            <StrategiesView filters={filters} />
        </div>
    );
}
