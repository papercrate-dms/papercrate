import { useMemo, useCallback, useRef, useEffect } from 'react';
import { isPointerModifierEvent, isPrimaryPointerEvent } from '../features/selection/useEntryPointer';
import { useDocumentsFilter } from '../context/DocumentsFilterContext';
import { useWorkspaceSelectionContext } from '../../app/WorkspaceSelectionContext';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import { useTagInteractions } from '../interactions/useTagInteractions';
import { subscribeToToast } from '../features/tagging/tagTransfer';
import { useAppShell } from '../../lib/context/AppShellContext';

const EntryType = {
    folder: 'folder',
    document: 'document',
};

export const useDocumentsContextValues = () => {
    const shell = useAppShell();
    const {
        preview: { ensureAssetUrl, getDocumentAsset },
        search: { isSearchLoading, searchQuery, activeTagFilters, activeCorrespondentFilters, searchResultIds, documents },
        folderTree: { selectedFolder },
        mutations: { handleDocumentDragStart, handleDocumentDragEnd, draggedDocumentIds: draggingDocumentIds, handleDocumentTagAttach, handleDocumentTagDetach },
        selection: { handleEntryPointerCore: onEntryPointer },
        correspondents: { activeCorrespondentIds, correspondentLookupById },
        tags: { tagLookupById },
    } = shell as any;

    const {
        setFocusedEntryKey,
    } = useWorkspaceSelectionContext();

    const {
        toggleTag: toggleTagFilter,
        toggleCorrespondent: toggleCorrespondentFilter,
    } = useDocumentsFilter();

    const scrollRef = useRef<HTMLElement | null>(null);
    const suppressDocumentClickRef = useRef(false);

    const { showToast } = useStatusToast();

    // Subscribe to tag operation results
    useEffect(() => {
        return subscribeToToast((message, type) => {
            showToast(message, type);
        });
    }, [showToast]);

    // Handlers
    const tagHandlers = useTagInteractions({
        onAssignTagToDocument: handleDocumentTagAttach,
        onRemoveTagFromDocument: handleDocumentTagDetach,
        onTagClick: toggleTagFilter,
    });

    // Derived State
    const draggingDocumentIdsSet = useMemo(
        () => new Set(draggingDocumentIds || []),
        [draggingDocumentIds],
    );
    const activeCorrespondentIdSet = useMemo(
        () => new Set(activeCorrespondentIds || []),
        [activeCorrespondentIds],
    );
    const showingSearchResults = Array.isArray(searchResultIds);
    const hasDocumentEntries = (documents || []).length > 0 || (showingSearchResults && (searchResultIds || []).length > 0);

    const viewId = useMemo(() => {
        if (showingSearchResults) {
            const trimmedQuery = (searchQuery || '').trim();
            const tagsKey = [...(activeTagFilters || [])].sort().join(',');
            const correspondentsKey = [...(activeCorrespondentFilters || [])].sort().join(',');
            return `search:${trimmedQuery}|tags:${tagsKey}|corr:${correspondentsKey}`;
        }
        const folderKey = selectedFolder && selectedFolder !== '' ? selectedFolder : 'root';
        return `folder:${folderKey}`;
    }, [
        showingSearchResults,
        searchQuery,
        activeTagFilters,
        activeCorrespondentFilters,
        selectedFolder,
    ]);

    const handleFolderClick = useCallback(
        (folder: any, event: any) => {
            if (!folder) {
                return;
            }

            if (onEntryPointer) {
                onEntryPointer(
                    { type: EntryType.folder, id: folder.id, key: `folder:${folder.id}`, folder },
                    event,
                );
            }

            if (
                !isPointerModifierEvent(event)
                && isPrimaryPointerEvent(event)
                && scrollRef.current
            ) {
                scrollRef.current.focus({ preventScroll: true });
                setFocusedEntryKey(`folder:${folder.id}`);
            }
        },
        [onEntryPointer, setFocusedEntryKey],
    );

    const handleDocumentDragStartLocal = useCallback(
        (event: any, doc: any) => {
            suppressDocumentClickRef.current = true;
            handleDocumentDragStart?.(event, doc);
        },
        [handleDocumentDragStart],
    );

    const handleDocumentDragEndLocal = useCallback(
        (event: any) => {
            handleDocumentDragEnd?.(event);
            requestAnimationFrame(() => {
                suppressDocumentClickRef.current = false;
            });
        },
        [handleDocumentDragEnd],
    );

    // Context Values Construction
    const assetContextValue = useMemo(() => ({
        ensureAssetUrl,
        getDocumentAsset,
    }), [ensureAssetUrl, getDocumentAsset]);

    const draggedFolderId = (shell as any).folderTree?.draggedFolderId;

    const viewStateContextValue = useMemo(() => ({
        viewId,
        scrollRef,
        tagLookupById,
        correspondentLookupById,
        activeCorrespondentIdSet,
        draggingDocumentIdsSet,
        draggedFolderId,
    }), [
        viewId,
        scrollRef,
        tagLookupById,
        activeCorrespondentIdSet,
        draggingDocumentIdsSet,
        draggedFolderId,
        correspondentLookupById,
    ]);

    const commandContextValue = useMemo(() => {
        const anyShell = shell as any;
        return {
            folder: {
                onClick: handleFolderClick,
                onSelect: anyShell.folderTree?.selectFolder,
                onRename: anyShell.folderTree?.handleFolderRename,
                onDrag: {
                    start: anyShell.folderTree?.handleFolderDragStart,
                    end: anyShell.folderTree?.handleFolderDragEnd,
                    over: anyShell.folderTree?.folderClickHandlers?.onDragOver,
                    leave: anyShell.folderTree?.folderClickHandlers?.onDragLeave,
                    drop: anyShell.folderTree?.folderClickHandlers?.onDrop,
                },
            },
            document: {
                onRename: anyShell.mutations?.handleDocumentTitleUpdate,
                onDrag: {
                    start: handleDocumentDragStartLocal,
                    end: handleDocumentDragEndLocal,
                },
            },
            correspondents: {
                onClick: toggleCorrespondentFilter,
            },
            onEntryPointer,
        }
    }, [
        handleFolderClick,
        shell,
        handleDocumentDragStartLocal,
        handleDocumentDragEndLocal,
        toggleCorrespondentFilter,
        onEntryPointer,
    ]);

    return {
        assetContextValue,
        viewStateContextValue,
        commandContextValue,
        tagHandlers,
        scrollRef,
        hasDocumentEntries,
        isSearchLoading,
        showingSearchResults,
        activeTagFilters,
        activeCorrespondentFilters,
    };
};
