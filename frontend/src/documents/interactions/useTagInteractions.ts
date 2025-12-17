import {
    useCallback,
    useEffect,
    useRef,
} from 'react';
import React from 'react';
import {
    isTagTransferEvent,
    parseTagTransferPayload,
    writeTagTransferData,
    getActiveDragState,
    clearTagTransferData,
    beginAction,
    finishAction,
} from '../../documents/features/tagging/tagTransfer';
import type { Identifier } from '../../types/identifiers';
import type { Document, Tag } from '../../types/documents';

const preventAll = (event?: React.SyntheticEvent | Event | null) => {
    if (!event) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
};

const createDragPreview = (node: EventTarget | null, clientX: number, clientY: number) => {
    if (!(node instanceof HTMLElement)) {
        return null;
    }
    const rect = node.getBoundingClientRect();
    const offsetX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    const clone = node.cloneNode(true) as HTMLElement;
    clone.style.position = 'absolute';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    clone.style.pointerEvents = 'none';
    clone.style.opacity = '1';
    clone.style.transform = 'none';
    document.body.appendChild(clone);
    return { clone, offsetX, offsetY };
};

const cleanupPreview = (previewNode: HTMLElement | null) => {
    if (previewNode && previewNode.parentNode) {
        previewNode.parentNode.removeChild(previewNode);
    }
};

interface UseTagInteractionsArgs {
    onAssignTagToDocument?: (docId: Identifier, tagId: Identifier) => Promise<boolean> | void;
    onRemoveTagFromDocument?: (docId: Identifier, tagId: Identifier) => Promise<boolean> | void;
    onTagClick?: (tagId: Identifier) => void;
}

interface DraggingTagState {
    element: HTMLElement | null;
    previewClone?: HTMLElement;
}

export interface TagInteractionHandlers {
    onTagDragEnter: (event: React.DragEvent<HTMLDivElement>, docId: Identifier) => void;
    onTagDragOver: (event: React.DragEvent<HTMLDivElement>, doc: Document) => void;
    onTagDragLeave: (event: React.DragEvent<HTMLDivElement>, docId: Identifier) => void;
    onTagDrop: (event: React.DragEvent<HTMLDivElement>, doc: Document) => void;
    onTagDragStart: (event: React.DragEvent<HTMLElement>, doc: Document, tag: Tag) => void;
    onTagDragEnd: (event: React.DragEvent<HTMLElement>) => void;
    onTagClick?: (tagId: Identifier) => void;
}

export const useTagInteractions = ({
    onAssignTagToDocument,
    onRemoveTagFromDocument,
    onTagClick,
}: UseTagInteractionsArgs): TagInteractionHandlers => {
    const draggingTagRef = useRef<DraggingTagState | null>(null);

    const isTagTransfer = useCallback((event: React.DragEvent) => isTagTransferEvent(event), []);

    const onTagDragEnter = useCallback(
        (event: React.DragEvent<HTMLDivElement>, _docId: Identifier) => {
            if (!isTagTransfer(event)) return;
            preventAll(event);
            event.currentTarget.classList.add('is-tag-target');
        },
        [isTagTransfer],
    );

    const onTagDragOver = useCallback(
        (event: React.DragEvent<HTMLDivElement>, doc: Document) => {
            if (!doc || !doc.id) return;
            if (!isTagTransfer(event)) return;
            preventAll(event);

            // Use shared state for all logic (Single Source of Truth)
            const { tagId: draggedTagId, sourceDocId: draggedSourceId } = getActiveDragState();

            const isAssigned = doc.tags?.some((t) => t === draggedTagId);

            if (event.dataTransfer) {
                const isSource = draggedSourceId === doc.id;

                // Otherwise: separate document.
                if (isSource || isAssigned) {
                    event.dataTransfer.dropEffect = 'none';
                    event.currentTarget.classList.remove('is-tag-target');
                    return;
                }

                const isFromDocument = !!draggedSourceId;
                if (isFromDocument) {
                    // Default to Move (transfer), allow Copy with Alt key
                    event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
                } else {
                    // Sidebar or external source: Copy only
                    event.dataTransfer.dropEffect = 'copy';
                }

                event.currentTarget.classList.add('is-tag-target');
            }
        },
        [isTagTransfer],
    );

    const onTagDragLeave = useCallback(
        (event: React.DragEvent<HTMLDivElement>, _docId: Identifier) => {
            if (!isTagTransfer(event)) return;
            // Ignore if leaving to a child element
            if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) {
                return;
            }
            event.currentTarget.classList.remove('is-tag-target');
        },
        [isTagTransfer],
    );

    const onTagDrop = useCallback(
        (event: React.DragEvent<HTMLElement>, doc: Document) => {
            if (!event?.dataTransfer || !doc?.id) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const isTagTransfer = isTagTransferEvent(event);
            if (!isTagTransfer) {
                return;
            }

            const payload = parseTagTransferPayload(event);
            const element = event.currentTarget as HTMLElement;
            element.classList.remove('is-tag-target');

            if (!payload || !payload.id) {
                return;
            }

            setTimeout(async () => {
                // Double-check assignment (even though cursor logic tries to prevent it)
                const isAssigned = doc.tags?.some((t) => t === payload.id);
                if (isAssigned) return;

                if (onAssignTagToDocument && doc.id) {
                    // Queue Result Logic
                    beginAction();
                    try {
                        await onAssignTagToDocument(doc.id, payload.id);
                        finishAction({ type: 'attach', success: true });
                    } catch {
                        finishAction({ type: 'attach', success: false });
                    }
                }
            }, 0);
        },
        [onAssignTagToDocument],
    );

    const onTagDragStart = useCallback(
        (event: React.DragEvent<HTMLElement>, doc: Document, tag: Tag) => {
            if (!event?.dataTransfer || !doc?.id || !tag?.id) {
                return;
            }
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'copyMove';
            writeTagTransferData(event.dataTransfer, tag, doc.id);

            const pointerX = event.clientX;
            const pointerY = event.clientY;
            const { clone, offsetX, offsetY } = createDragPreview(event.currentTarget, pointerX, pointerY) || {};
            if (clone) {
                event.dataTransfer.setDragImage(clone, offsetX || 0, offsetY || 0);
            }

            const element = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
            if (element) {
                element.classList.add('is-drag-hidden');
            }

            draggingTagRef.current = {
                element,
                previewClone: clone,
            };
        },
        [],
    );

    const onTagDragEnd = useCallback(
        (event: React.DragEvent<HTMLElement>) => {
            event.stopPropagation();
            const { sourceDocId, tagId } = getActiveDragState();
            const dropEffect = event?.dataTransfer?.dropEffect;

            clearTagTransferData();

            setTimeout(async () => {
                const state = draggingTagRef.current;
                if (state) {
                    const element = state.element;
                    if (element) {
                        element.classList.remove('is-drag-hidden');
                    }
                    cleanupPreview(state.previewClone);

                    // Remove if move operation completed
                    if (dropEffect === 'move') {
                        if (onRemoveTagFromDocument && sourceDocId && tagId) {
                            beginAction();
                            try {
                                await onRemoveTagFromDocument(sourceDocId, tagId);
                                finishAction({ type: 'detach', success: true });
                            } catch {
                                finishAction({ type: 'detach', success: false });
                            }
                        }
                    }
                }
                draggingTagRef.current = null;
            }, 0);
        },
        [onRemoveTagFromDocument],
    );

    useEffect(() => {
        return () => {
            if (draggingTagRef.current && draggingTagRef.current.previewClone) {
                cleanupPreview(draggingTagRef.current.previewClone);
            }
            draggingTagRef.current = null;
        };
    }, []);

    return {
        onTagDragEnter,
        onTagDragOver,
        onTagDragLeave,
        onTagDrop,
        onTagDragStart,
        onTagDragEnd,
        onTagClick,
    };
};
