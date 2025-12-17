import React, { useMemo } from 'react';
import { getTagColorStyle } from '../../utils/colors';
import type { Document, Tag } from '../../types/documents';
import type { Identifier } from '../../types/identifiers';
import type { TagInteractionHandlers } from '../interactions/useTagInteractions';

interface DocumentTagsProps {
    tags: Identifier[];
    tagLookupById?: Map<Identifier, Tag> | null;
    doc: Document;
    tagHandlers?: TagInteractionHandlers;
}

const DocumentTags: React.FC<DocumentTagsProps> = ({
    tags,
    tagLookupById,
    doc,
    tagHandlers,
}) => {
    const resolvedTags = useMemo(() => {
        if (!tags) return [];
        return tags
            .map(id => tagLookupById?.get(id))
            .filter((tag): tag is Tag => Boolean(tag))
            .sort((a, b) => {
                const labelA = a.label.toLowerCase();
                const labelB = b.label.toLowerCase();
                return labelA.localeCompare(labelB);
            });
    }, [tags, tagLookupById]);

    if (resolvedTags.length === 0) {
        return null;
    }

    return (
        <>
            {resolvedTags.map((tag, index) => {
                const { color, label, id } = tag;
                const tagId = id;

                const style = getTagColorStyle(color);
                const clickable = tagId != null && typeof tagHandlers?.onTagClick === 'function';
                const draggable = !!tagId;
                const key = tagId ?? `${doc.id}-tag-${index}`;

                return (
                    <span
                        key={key}
                        className={`badge tag-chip${draggable ? ' tag-chip--draggable' : ''}${clickable ? ' tag-chip--clickable' : ''}`}
                        style={style || undefined}
                        title={label || ''}
                        role={clickable ? 'button' : undefined}
                        onClick={clickable ? (event) => {
                            event.stopPropagation();
                            if (tagId == null) return;
                            tagHandlers?.onTagClick?.(tagId);
                        } : undefined}
                        draggable={draggable}
                        onDragStart={(event) => tagId && tagHandlers?.onTagDragStart(event, doc, tag)}
                        onDragEnd={tagHandlers?.onTagDragEnd}
                        onKeyDown={clickable ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                if (tagId == null) return;
                                tagHandlers?.onTagClick?.(tagId);
                            }
                        } : undefined}
                    >
                        {label}
                    </span>
                );
            })}
        </>
    );
};

export default DocumentTags;
