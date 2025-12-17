import React, { useCallback, useMemo } from 'react';
import { PlusIcon, SettingsIcon } from '../../components/icons';
import { getTagColorStyle } from '../../utils/colors';
import { writeTagTransferData, clearTagTransferData } from '../../documents/features/tagging/tagTransfer';
import type { Identifier } from '../../types/identifiers';
import { useDocumentsFilter } from '../../documents/context/DocumentsFilterContext';

import type { Tag } from '../../types/documents';

interface SidebarTagListProps {
    tags: Tag[];
    untaggedFilterId: Identifier | null;
    onCreateTag?: (payload: { label: string }) => Promise<void> | void;
    onManageTags?: () => void;
}

const SidebarTagList: React.FC<SidebarTagListProps> = ({
    tags,
    untaggedFilterId,
    onCreateTag,
    onManageTags,
}) => {
    const {
        activeTagIds,
        toggleTag: toggleTagFilter,
    } = useDocumentsFilter();

    const activeTagSet = useMemo(
        () => new Set<Identifier | null>(activeTagIds || []),
        [activeTagIds],
    );

    const untaggedActive = untaggedFilterId ? activeTagSet.has(untaggedFilterId) : false;
    const untaggedButtonClassName = ['badge', 'tag-chip', 'tag-chip--untagged', untaggedActive ? 'active' : null]
        .filter(Boolean)
        .join(' ');

    const getTagChipClassName = (isActive: boolean) =>
        ['badge', 'tag-chip', isActive ? 'active' : null]
            .filter(Boolean)
            .join(' ');

    const handleCreateTag = useCallback(async () => {
        const input = window.prompt('New tag name');
        if (!input) {
            return;
        }
        const trimmed = input.trim();
        if (!trimmed) {
            return;
        }
        try {
            await onCreateTag?.({ label: trimmed });
        } catch (error: unknown) {
            console.error('[sidebar] failed to create tag', error);
        }
    }, [onCreateTag]);

    const handleToggleTag = useCallback((tagId: Identifier | null) => {
        if (tagId == null) return;
        toggleTagFilter(tagId);
    }, [toggleTagFilter]);

    return (
        <div className="sidebar-section">
            <div className="sidebar-section__header">
                <h3>Tags</h3>
                <div className="sidebar-section__actions">
                    <button
                        type="button"
                        className="icon-button"
                        onClick={handleCreateTag}
                        aria-label="Create tag"
                    >
                        <PlusIcon size={16} />
                    </button>
                    <button
                        type="button"
                        className="icon-button"
                        onClick={onManageTags}
                        aria-label="Manage tags"
                    >
                        <SettingsIcon size={16} />
                    </button>
                    <span className="meta">{tags.length}</span>
                </div>
            </div>
            <div
                className={`sidebar-tag-cloud${activeTagSet.size ? ' sidebar-tag-cloud--has-active' : ''}`}
                role="list"
            >
                {untaggedFilterId ? (
                    <button
                        type="button"
                        role="listitem"
                        className={untaggedButtonClassName}
                        onClick={() => handleToggleTag(untaggedFilterId)}
                        aria-pressed={untaggedActive}
                        draggable={false}
                    >
                        No tag assigned
                    </button>
                ) : null}
                {tags.map((tag) => {
                    const isActive = activeTagSet.has(tag.id);
                    const style = getTagColorStyle(tag.color);
                    const className = getTagChipClassName(isActive);
                    return (
                        <button
                            key={tag.id}
                            type="button"
                            role="listitem"
                            className={className}
                            style={style || undefined}
                            onClick={() => handleToggleTag(tag.id)}
                            aria-pressed={isActive}
                            draggable
                            onDragStart={(event) => {
                                try {
                                    event.dataTransfer.effectAllowed = 'copy';
                                    writeTagTransferData(event.dataTransfer, tag);
                                } catch (error) {
                                    console.warn('[sidebar] Failed to set tag drag payload', error);
                                }
                            }}
                            onDragEnd={clearTagTransferData}
                        >
                            {tag.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default SidebarTagList;
