import PositionsView from './PositionsView';

export default function PositionsTable({ filters = {} }) {
    return (
        <div className="bg-white rounded-lg shadow">
            <PositionsView filters={filters} />
        </div>
    );
}
