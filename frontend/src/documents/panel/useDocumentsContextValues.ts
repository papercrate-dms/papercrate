import { useMemo, useCallback, useRef, useEffect } from 'react';
import { isPointerModifierEvent, isPrimaryPointerEvent } from '../features/selection/useEntryPointer';
import { useDocumentsFilter } from '../context/DocumentsFilterContext';
import { useWorkspaceSelectionContext } from '../../app/WorkspaceSelectionContext';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import { useTagInteractions } from '../interactions/useTagInteractions';
import { subscribeToToast } from '../features/tagging/tagTransfer';
import { useTags } from '../../lib/context/TagsContext';
import { useCorrespondents } from '../../lib/context/CorrespondentsContext';
import { useFolderTree } from '../../lib/context/FolderTreeContext';
import { useDocumentsSearch } from '../../lib/context/DocumentsSearchContext';
import { useDocumentsWorkspaceContext } from '../../lib/context/DocumentsWorkspaceContext';
import { EntryType } from '../../constants/documents';

export const useDocumentsContextValues = () => {
    const { ensureAssetUrl, getDocumentAsset } = useDocumentsWorkspaceContext();
    const { searchLoading: isSearchLoading, searchQuery, searchResultIds, documents } = useDocumentsSearch();
    const { selectedFolder, draggedFolderId, selectFolder, handleFolderRename, handleFolderDragStart, handleFolderDragEnd, folderClickHandlers } = useFolderTree();
    const { handleDocumentDragStart, handleDocumentDragEnd, draggedDocumentIds: draggingDocumentIds, handleDocumentTagAttach, handleDocumentTagDetach, handleEntryPointerCore: onEntryPointer, handleDocumentTitleUpdate } = useDocumentsWorkspaceContext();
    const { activeCorrespondentIds, correspondentLookupById } = useCorrespondents();
    const { tagLookupById, activeTagFilters } = useTags();

    const {
        setFocusedEntryKey,
    } = useWorkspaceSelectionContext();

    const {
        toggleTag: toggleTagFilter,
        toggleCorrespondent: toggleCorrespondentFilter,
    } = useDocumentsFilter();

    const activeCorrespondentFilters = useCorrespondents().activeCorrespondentFilters;

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
        onAssignTagToDocument: handleDocumentTagAttach as (docId: string, tagId: string) => Promise<boolean> | void,
        onRemoveTagFromDocument: handleDocumentTagDetach as (docId: string, tagId: string) => Promise<boolean> | void,
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

    const commandContextValue = useMemo(() => ({
        folder: {
            onClick: handleFolderClick,
            onSelect: selectFolder,
            onRename: handleFolderRename,
            onDrag: {
                start: handleFolderDragStart,
                end: handleFolderDragEnd,
                over: folderClickHandlers?.onDragOver,
                leave: folderClickHandlers?.onDragLeave,
                drop: folderClickHandlers?.onDrop,
            },
        },
        document: {
            onRename: handleDocumentTitleUpdate,
            onDrag: {
                start: handleDocumentDragStartLocal,
                end: handleDocumentDragEndLocal,
            },
        },
        correspondents: {
            onClick: toggleCorrespondentFilter,
        },
        onEntryPointer,
    }), [
        handleFolderClick,
        selectFolder,
        handleFolderRename,
        handleFolderDragStart,
        handleFolderDragEnd,
        folderClickHandlers,
        handleDocumentTitleUpdate,
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
