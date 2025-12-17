import React, { useCallback, useMemo } from 'react';
import { PlusIcon, SettingsIcon } from '../../components/icons';
import type { Identifier } from '../../types/identifiers';
import { useDocumentsFilter } from '../../documents/context/DocumentsFilterContext';

import type { Correspondent } from '../../types/documents';

interface SidebarCorrespondentListProps {
    correspondents: Correspondent[];
    onCreateCorrespondent?: (payload: { name: string }) => Promise<void> | void;
    onManageCorrespondents?: () => void;
}

const SidebarCorrespondentList: React.FC<SidebarCorrespondentListProps> = ({
    correspondents,
    onCreateCorrespondent,
    onManageCorrespondents,
}) => {
    const {
        activeCorrespondentIds,
        toggleCorrespondent: toggleCorrespondentFilter,
    } = useDocumentsFilter();

    const sortedCorrespondents = useMemo<Correspondent[]>(() => {
        if (!Array.isArray(correspondents)) {
            return [];
        }
        return correspondents
            .filter((entry): entry is Correspondent & { name: string } => Boolean(entry?.name))
            .slice()
            .sort((a, b) => a.name!.localeCompare(b.name!, undefined, { sensitivity: 'base' }));
    }, [correspondents]);

    const activeCorrespondentSet = useMemo(
        () => new Set<Identifier>(activeCorrespondentIds || []),
        [activeCorrespondentIds],
    );

    const handleCreateCorrespondent = useCallback(async () => {
        const input = window.prompt('New correspondent name');
        if (!input) {
            return;
        }
        const trimmed = input.trim();
        if (!trimmed) {
            return;
        }
        try {
            await onCreateCorrespondent?.({ name: trimmed });
        } catch (error: unknown) {
            console.error('[sidebar] failed to create correspondent', error);
        }
    }, [onCreateCorrespondent]);

    const handleToggleCorrespondent = useCallback((correspondentId: Identifier | null) => {
        toggleCorrespondentFilter(correspondentId);
    }, [toggleCorrespondentFilter]);

    return (
        <div className="sidebar-section">
            <div className="sidebar-section__header">
                <h3>Correspondents</h3>
                <div className="sidebar-section__actions">
                    <button
                        type="button"
                        className="icon-button"
                        onClick={handleCreateCorrespondent}
                        aria-label="Create correspondent"
                    >
                        <PlusIcon size={16} />
                    </button>
                    <button
                        type="button"
                        className="icon-button"
                        onClick={onManageCorrespondents}
                        aria-label="Manage correspondents"
                    >
                        <SettingsIcon size={16} />
                    </button>
                    <span className="meta">{correspondents.length}</span>
                </div>
            </div>
            <ul className="sidebar-correspondent-list">
                {sortedCorrespondents.map((correspondent) => {
                    const isActive = activeCorrespondentSet.has(correspondent.id);
                    const className = `sidebar-correspondent-item${isActive ? ' active' : ''}`;
                    const handleSelect = () => {
                        const nextId = isActive ? null : correspondent.id;
                        handleToggleCorrespondent(nextId);
                    };
                    return (
                        <li key={correspondent.id}>
                            <span
                                className={className}
                                role="button"
                                onClick={handleSelect}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        handleSelect();
                                    }
                                }}
                            >
                                {correspondent.name}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default SidebarCorrespondentList;
