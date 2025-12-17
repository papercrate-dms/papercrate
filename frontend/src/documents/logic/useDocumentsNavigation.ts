import React, { useCallback, useMemo } from 'react';
import type { DocumentsListEntry } from '../../types/documents';
import { useWorkspaceSelectionContext } from '../../app/WorkspaceSelectionContext';
import { useDocumentOpen } from '../../lib/context/DocumentOpenContext';

interface UseDocumentsNavigationProps {
    entries: DocumentsListEntry[];
    onFolderSelect?: (folderId: string) => void;
    viewMode?: string;
    scrollRef?: React.RefObject<HTMLElement | null>;
}

export const useDocumentsNavigation = ({
    entries,
    onFolderSelect,
    viewMode,
    scrollRef,
}: UseDocumentsNavigationProps) => {
    const {
        selectedEntries,
        focusedEntryKey,
        setFocusedEntryKey,
        handleEntrySelection,
        applySelection,
    } = useWorkspaceSelectionContext();

    const { openDocument } = useDocumentOpen();

    const navigableRows = useMemo(
        () => entries.map((entry) => ({ key: entry.key, type: entry.type, id: entry.id })),
        [entries],
    );
    const navigableEntryKeys = useMemo(() => navigableRows.map((row) => row.key), [navigableRows]);

    const getEntryByKey = useCallback(
        (entryKey: string) => entries.find((entry) => entry.key === entryKey) || null,
        [entries],
    );

    const getGridColumns = useCallback(() => {
        if (!scrollRef?.current) return 1;
        const grid = scrollRef.current.querySelector('.documents-grid');
        if (!grid) return 1;
        const style = window.getComputedStyle(grid);
        const templateColumns = style.gridTemplateColumns;
        if (!templateColumns) return 1;
        return templateColumns.split(' ').length;
    }, [scrollRef]);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            // Only handle events that target the container directly
            if (event.target !== event.currentTarget) {
                return;
            }

            const { key, shiftKey } = event;
            const triggers = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ', 'Space', 'Spacebar'];
            if (!triggers.includes(key)) {
                return;
            }

            if (!navigableRows.length) {
                return;
            }

            // Allow default scrolling for Home/End if not preventing default
            if (key !== 'Home' && key !== 'End') {
                event.preventDefault();
            } else {
                // Prevent default only if we are handling selection move, otherwise let browser scroll
                event.preventDefault();
            }

            let activeKey =
                focusedEntryKey && navigableEntryKeys.includes(focusedEntryKey)
                    ? focusedEntryKey
                    : null;

            if (!activeKey) {
                if (selectedEntries.length) {
                    for (let index = selectedEntries.length - 1; index >= 0; index -= 1) {
                        const candidate = selectedEntries[index];
                        if (navigableEntryKeys.includes(candidate)) {
                            activeKey = candidate;
                            break;
                        }
                    }
                }

                if (!activeKey) {
                    activeKey = (key === 'ArrowUp' || key === 'ArrowLeft')
                        ? navigableEntryKeys[navigableEntryKeys.length - 1]
                        : navigableEntryKeys[0];
                }
            }

            const currentIndex = navigableEntryKeys.indexOf(activeKey);
            const activeRow = currentIndex === -1 ? null : navigableRows[currentIndex];

            if (key === 'Enter' || key === ' ' || key === 'Space' || key === 'Spacebar') {
                if (activeRow) {
                    event.preventDefault();
                    // Do not call handleEntrySelection here, as it resets selection if multiple items are selected.
                    // Space/Enter should just trigger the action (Preview/Open) on the focused item
                    // without modifying the selection state.

                    if (activeRow.type === 'folder') {
                        onFolderSelect?.(activeRow.id as string);
                    } else {
                        const entry = getEntryByKey(activeRow.key);
                        if (entry && entry.type === 'document') {
                            const isPreview = key === ' ' || key === 'Space' || key === 'Spacebar';
                            openDocument(entry.document, isPreview ? 'preview' : 'inspect');
                        }
                    }
                }
                return;
            }

            let nextIndex = currentIndex;
            const isGrid = viewMode === 'grid';
            const columns = isGrid ? getGridColumns() : 1;

            if (key === 'ArrowDown') {
                if (isGrid) {
                    if (currentIndex + columns < navigableRows.length) {
                        nextIndex = currentIndex + columns;
                    }
                } else {
                    nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, navigableRows.length - 1);
                }
            } else if (key === 'ArrowUp') {
                if (isGrid) {
                    if (currentIndex - columns >= 0) {
                        nextIndex = currentIndex - columns;
                    }
                } else {
                    nextIndex = currentIndex === -1 ? navigableRows.length - 1 : Math.max(currentIndex - 1, 0);
                }
            } else if (key === 'ArrowLeft') {
                nextIndex = Math.max(currentIndex - 1, 0);
            } else if (key === 'ArrowRight') {
                nextIndex = Math.min(currentIndex + 1, navigableRows.length - 1);
            } else if (key === 'Home') {
                nextIndex = 0;
            } else if (key === 'End') {
                nextIndex = navigableRows.length - 1;
            }

            if (nextIndex === -1 || nextIndex >= navigableRows.length || nextIndex === currentIndex) {
                return;
            }

            const targetRow = navigableRows[nextIndex];
            if (!targetRow) {
                return;
            }

            setFocusedEntryKey(targetRow.key);

            if (shiftKey) {
                // Additive selection for Shift+Arrow (Finder style)
                const newSelection = Array.from(new Set([...selectedEntries, targetRow.key]));
                applySelection(newSelection, { anchor: targetRow.key, interactedKeys: [targetRow.key] });
            } else {
                handleEntrySelection(targetRow.key, {
                    shiftKey,
                    preventDefault: () => { },
                });
            }
        },
        [
            focusedEntryKey,
            getEntryByKey,
            navigableEntryKeys,
            navigableRows,
            onFolderSelect,
            selectedEntries,
            openDocument,
            handleEntrySelection,
            setFocusedEntryKey,
            viewMode,
            getGridColumns,
            applySelection,
        ],
    );

    const handleFocus = useCallback(() => {
        let resolvedKey = null;

        if (focusedEntryKey && navigableEntryKeys.includes(focusedEntryKey)) {
            resolvedKey = focusedEntryKey;
        }

        if (!resolvedKey) {
            for (let index = selectedEntries.length - 1; index >= 0; index -= 1) {
                const candidate = selectedEntries[index];
                if (navigableEntryKeys.includes(candidate)) {
                    resolvedKey = candidate;
                    break;
                }
            }
        }

        if (!resolvedKey) {
            if (!selectedEntries.length) {
                return;
            }
            if (navigableRows.length) {
                resolvedKey = navigableRows[0].key;
            }
        }

        if (!resolvedKey) {
            return;
        }

        setFocusedEntryKey(resolvedKey);
    }, [
        focusedEntryKey,
        navigableEntryKeys,
        navigableRows,
        setFocusedEntryKey,
        selectedEntries,
    ]);

    return {
        handleKeyDown,
        handleFocus,
    };
};
