import React from 'react';

const icons = {
    note: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
    ),
    expired: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 17.25L21 21" />
        </svg>
    ),
    ungroup: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.181 8.68l-4.503-4.503M8.678 13.181l-4.503-4.503m15.647 4.503l-4.503 4.503m4.503-9.006l-4.503-4.503M3.75 21h.008v.008H3.75V21zm0-3h.008v.008H3.75V18zm0-3h.008v.008H3.75V15zm3 6h.008v.008H6.75V21zm3 0h.008v.008H9.75V21zm3-18h.008v.008h-.008V3zm3 0h.008v.008h-.008V3zm3 0h.008v.008h-.008V3zm0 3h.008v.008h-.008V6zm0 3h.008v.008h-.008V9z" />
        </svg>
    ),
    gear: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    ),
};

export default function ActionToolbar({ position, onAction, isOpen, onToggle }) {
    if (!position) return null;

    const isMultiLeg = position.isMultiLeg;
    const isOption = position.asset_type === 'option';

    const actions = [];
    actions.push({ id: 'note', label: position.notes ? 'Edit Note' : 'Add Note', icon: icons.note });
    if (isOption && !isMultiLeg) {
        actions.push({ id: 'expired', label: 'Mark Expired', icon: icons.expired });
    }
    if (isMultiLeg) {
        actions.push({ id: 'ungroup', label: 'Ungroup', icon: icons.ungroup });
    }

    return (
        <div className="inline-flex items-center gap-0.5 flex-shrink-0">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                className={`p-1 rounded-md transition-colors ${
                    isOpen
                        ? 'text-purple-600 bg-purple-50'
                        : 'text-gray-300 hover:text-gray-500'
                }`}
                title="Actions"
            >
                {icons.gear}
            </button>
            {isOpen && actions.map(action => (
                <button
                    key={action.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        onAction(action.id, position);
                    }}
                    className="p-1 rounded-md text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                    title={action.label}
                >
                    {action.icon}
                </button>
            ))}
        </div>
    );
}
