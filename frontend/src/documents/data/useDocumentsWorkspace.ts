import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useMatch, useParams } from 'react-router-dom';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import useViewerState from './useViewerState';
import { useEntryPointer as useEntryPointerCore } from '../features/selection/useEntryPointer';
import useBulkDocumentActions from './useBulkDocumentActions';
import { DEFAULT_SORT_DIRECTION, DEFAULT_SORT_FIELD } from '../../app/workspaceUtils';
import { createDocumentEntryKey, createFolderEntryKey } from '../../app/entryKey';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import useDocumentDragHandlers from '../features/upload/useDocumentDragHandlers';
import useDocumentMutations from './useDocumentMutations';
import { resolveBreadcrumbs } from '../logic/breadcrumbs';
import useWorkspaceManagers, { extractDocumentFromResponse } from './useWorkspaceManagers';
import { useAppDispatch, useAppState } from '../../lib/store/appState';

import { useWorkspaceSelection } from '../../app/useWorkspaceSelection';
import { EntryType } from '../../constants/documents';
import type { DocumentId, FolderNodeId, Identifier } from '../../types/identifiers';

const noop = () => { };

interface UseDocumentsWorkspaceOptions {
  documentsViewMode?: string;
  documentsSortField?: string;
  documentsSortDirection?: string;
  onDocumentsViewModeChange?: (mode: string) => void;
  onDocumentsSortFieldChange?: (field: string) => void;
  onDocumentsSortDirectionToggle?: () => void;
  searchIncludeDescendants?: boolean;
  onSetSearchIncludeDescendants?: (value: boolean) => void;
}

const useDocumentsWorkspace = ({
  documentsViewMode = 'list',
  documentsSortField = DEFAULT_SORT_FIELD,
  documentsSortDirection = DEFAULT_SORT_DIRECTION,
  onDocumentsViewModeChange,
  onDocumentsSortFieldChange,
  onDocumentsSortDirectionToggle,
  searchIncludeDescendants = true,
  onSetSearchIncludeDescendants,
}: UseDocumentsWorkspaceOptions = {}) => {
  const handleDocumentsViewModeChange = onDocumentsViewModeChange || noop;
  const handleDocumentsSortFieldChange = onDocumentsSortFieldChange || noop;
  const handleDocumentsSortDirectionToggle = onDocumentsSortDirectionToggle || noop;
  const setSearchIncludeDescendants = onSetSearchIncludeDescendants || noop;

  const location = useLocation();
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const params = useParams<{ folderId?: string; documentId?: string }>();
  const isTrashRoute = useMatch('/trash') !== null;
  const routeFolderId = isTrashRoute ? 'trash' : (params.folderId || null);
  const routeDocumentId = params.documentId || null;

  const { status: appStatus, token } = appState;
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const [selectedFolder, setSelectedFolder] = useState<FolderNodeId>(routeFolderId || 'root');

  const [draggedDocumentIds, setDraggedDocumentIds] = useState<DocumentId[]>([]);
  const [draggedFolderId, setDraggedFolderId] = useState<FolderNodeId | null>(null);
  const shellRef = useRef(null);

  const {
    assetManager, tagManager, correspondentManager, foldersManager, documentsManager,
    documents, setDocuments, documentLookup,
    tagSnapshot, correspondentSnapshot, foldersSnapshot,
  } = useWorkspaceManagers();

  const selectionState = useWorkspaceSelection();
  const {
    selectedEntries, selectedDocumentIds, selectedFolderIds,
    setSelectedEntries, setSelectionOrder, selectionOrderRef, selectionAnchorRef,
    selectionInitializedRef, focusedDocumentId, setFocusedDocumentId,
    focusedEntryKey, setFocusedEntryKey,
    applySelection, handleEntrySelection, clearSelection,
    promoteSelectionOrder: promoteSelectionOrderRaw, configureSelectionEnvironment,
  } = selectionState;

  const viewer = useViewerState({
    routeDocumentId, selectedFolder,
    locationPathname: location.pathname, locationSearch: location.search,
    assetManager, documentsManager, notifyApiError,
  });
  const {
    detailPanelDocId, detailPanelOpen, openDetailPanel, closeDetailPanel,
    activeViewerId, setActiveViewerId, viewerDocumentId, viewerActive,
    openDocumentViewerForDetail, closeDocumentViewer, resetAllViewerState,
    viewerReturnPath, getDocumentAsset, ensureAssetUrl,
  } = viewer;

  // --- Folder label map for mutation toast messages ---
  const folderLabelMap = useMemo(() => {
    const map = new Map<FolderNodeId, string>();
    foldersSnapshot.forEach((folder, id) => map.set(id as FolderNodeId, folder.name || 'Folder'));
    return map;
  }, [foldersSnapshot]);

  const bootstrapInitializedRef = useRef(false);

  const resolveTargetDocumentIds = useCallback(
    (candidateIds) => {
      const normalized = Array.isArray(candidateIds) ? candidateIds.filter(Boolean) : [];
      return normalized.length ? Array.from(new Set(normalized)) : selectedDocumentIds;
    },
    [selectedDocumentIds],
  );

  const {
    handleDocumentDragStart, handleDocumentDragEnd,
    handleFolderDragStart, handleFolderDragEnd,
  } = useDocumentDragHandlers({
    documentLookup, setDraggedDocumentIds, setDraggedFolderId, documentsViewMode,
    selectedEntries, selectedDocumentIds, selectedFolderIds,
    applySelection, handleEntrySelection,
  });

  // --- Reset / bootstrap / route-sync ---

  const resetWorkspaceState = useCallback(() => {
    setSelectedFolder('root');
    setDocuments([]);
    setSelectedEntries([]);
    setSelectionOrder([]);
    selectionOrderRef.current = [];
    setFocusedDocumentId(null);
    selectionAnchorRef.current = null;
    setDraggedDocumentIds([]);
    setDraggedFolderId(null);
    resetAllViewerState();
    assetManager.reset();
    bootstrapInitializedRef.current = false;
    selectionInitializedRef.current = false;
  }, [
    assetManager, resetAllViewerState, selectionAnchorRef, selectionInitializedRef,
    selectionOrderRef, setFocusedDocumentId, setSelectedEntries, setSelectionOrder,
    setSelectedFolder, setDocuments, setDraggedDocumentIds, setDraggedFolderId,
  ]);

  const resetWorkspaceStateRef = useRef(resetWorkspaceState);
  useEffect(() => { resetWorkspaceStateRef.current = resetWorkspaceState; });

  useEffect(() => {
    if (appStatus === 'logged-out' || appStatus === 'selecting-tenant') {
      resetWorkspaceStateRef.current();
    }
  }, [appStatus]);

  // --- Mutations ---

  const documentMutationsResult = useDocumentMutations({
    documentsState: { documentLookup, setDocuments, documentsManager },
    folderState: { selectedFolder, folderLabelMap },
    selectionState,
    tagsState: { tags: Array.from(tagSnapshot.values()) as any, tagLookupById: tagSnapshot, refreshTags: async () => { tagManager.ensureAll(true).catch(() => {}); }, tagManager },
    correspondentsState: { correspondents: Array.from(correspondentSnapshot.values()) as any, correspondentLookupById: correspondentSnapshot, correspondentLookupByName: new Map(), refreshCorrespondents: async () => { correspondentManager.ensureAll(true).catch(() => {}); }, correspondentManager },
    closeDocumentViewer, viewerDocumentId, resolveTargetDocumentIds,
  });

  const {
    moveDocumentsToFolder, handleDocumentsDelete,
    handleDocumentTagAdd, handleDocumentTagAttach, handleDocumentTitleUpdate,
    handleDocumentIssuedUpdate, handleDocumentTagDetach,
    handleDocumentCorrespondentAttach, handleDocumentCorrespondentDetach,
    handleDocumentCorrespondentAdd, handleBulkCorrespondentAdd, handleBulkCorrespondentRemove,
    handleBulkTagAddFromDetail, handleBulkTagRemoveFromDetail, handleBulkSelectionReanalyze,
  } = documentMutationsResult;

  const handleFolderDelete = useCallback(
    async (folderId: FolderNodeId, { showMessage = true }: { showMessage?: boolean } = {}) => {
      if (!folderId || folderId === 'root') {
        if (showMessage) showToast('The root folder cannot be removed.', 'error');
        return false;
      }
      try {
        await foldersManager.delete(folderId);
        if (selectedFolder === folderId) {
          const folder = foldersSnapshot.get(folderId as string);
          setSelectedFolder(folder?.parent_id || 'root');
        }
        if (showMessage) showToast('Folder deleted.', 'success');
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to delete folder.';
        notifyApiError(error, message);
        if (showMessage) showToast(message, 'error');
        return false;
      }
    },
    [foldersSnapshot, notifyApiError, selectedFolder, foldersManager, setSelectedFolder, showToast],
  );

  // --- Bootstrap ---

  const initializeAfterLogin = useCallback(async () => {
    await Promise.all([
      tagManager.ensureAll(true).catch(() => {}),
      correspondentManager.ensureAll(true).catch(() => {}),
      foldersManager.ensureTree(),
    ]);
    setSelectedFolder(routeFolderId && routeFolderId !== 'root' ? routeFolderId : 'root');
  }, [tagManager, correspondentManager, routeFolderId, setSelectedFolder, foldersManager]);

  const prevRouteFolderIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!token || appStatus !== 'ready') return;
    const targetParam = routeFolderId ?? 'root';
    if (targetParam === 'root' && routeDocumentId) return;
    if (targetParam !== prevRouteFolderIdRef.current) {
      prevRouteFolderIdRef.current = targetParam;
      setSelectedFolder(targetParam);
    }
  }, [token, appStatus, routeFolderId, routeDocumentId, setSelectedFolder]);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    if (appStatus !== 'authenticated' || bootstrapInitializedRef.current) return;
    const bootstrap = async () => {
      bootstrapInitializedRef.current = true;
      appDispatch({ type: 'BOOTSTRAP_START' });
      try {
        await initializeAfterLogin();
        if (mountedRef.current) appDispatch({ type: 'BOOTSTRAP_SUCCESS' });
      } catch (error) {
        if (mountedRef.current) {
          appDispatch({ type: 'BOOTSTRAP_FAILURE', error: error?.message || 'Failed to initialize data.' });
          bootstrapInitializedRef.current = false;
        }
      }
    };
    bootstrap();
  }, [appStatus, appDispatch, initializeAfterLogin]);

  // --- Bulk actions ---

  const { handleDeleteSelection } = useBulkDocumentActions({
    selectedDocumentIds, selectedFolderIds,
    handleDocumentsDelete, handleFolderDelete,
    clearSelection,
  });

  // --- Detail panel ---

  const detailPanelProps = {
    documentId: detailPanelDocId,
    onOpenViewer: openDocumentViewerForDetail,
    onFolderNavigate: setSelectedFolder,
    onClose: closeDetailPanel,
    resolveFolderPath: (folderId) => resolveBreadcrumbs(folderId || 'root', foldersSnapshot as any),
    folderNodes: foldersSnapshot,
  };

  // --- Entry pointer ---

  const handleEntryPointerCore = useEntryPointerCore({
    onSelectEntry: (entry, event, { rowKey, modifierClick, primaryClick }) => {
      const { type, id } = entry;
      const key = rowKey || (type === EntryType.document ? createDocumentEntryKey(id) : createFolderEntryKey(id));
      if (key) {
        if (documentsViewMode === 'grid' && (event as any).shiftKey) {
          applySelection(Array.from(new Set([...selectedEntries, key])), { anchor: key, interactedKeys: [key] });
        } else {
          handleEntrySelection(key, event);
        }
      }
      if (type === EntryType.folder && !modifierClick && primaryClick) {
        setSelectedFolder(id);
      }
    },
  });

  // --- Provider props (passed directly to providers in index.tsx) ---

  return {
    appStatus,
    location,
    shellRef,

    // FolderProvider
    folderProps: {
      foldersManager, foldersSnapshot, selectedFolder, setSelectedFolder,
      documentsSortField, documentsSortDirection, setDocuments, setSelectedEntries,
    },

    // DocumentsSearchProvider
    searchProps: {
      searchIncludeDescendants, documentsSortField, documentsSortDirection,
      setSearchIncludeDescendants, documentsManager, documentsViewMode,
      handleDocumentsViewModeChange, handleDocumentsSortFieldChange,
      handleDocumentsSortDirectionToggle, rawDocuments: documents, documentLookup,
    },

    // TagsProvider
    tagsProps: {
      tagManager, documentsManager,
      handleDocumentTagAttach, handleDocumentTagDetach,
      handleBulkTagAddFromDetail, handleBulkTagRemoveFromDetail,
    },

    // CorrespondentsProvider
    correspondentsProps: {
      correspondentManager, documentsManager,
      handleDocumentCorrespondentAttach, handleDocumentCorrespondentDetach,
      handleDocumentCorrespondentAdd, handleBulkCorrespondentAdd, handleBulkCorrespondentRemove,
    },

    // FolderTreeProvider
    folderTreeProps: {
      moveDocumentsToFolder, draggedDocumentIds, draggedFolderId,
      setDraggedDocumentIds, setDraggedFolderId, handleFolderDragStart, handleFolderDragEnd,
    },

    // DocumentsWorkspaceProvider
    workspaceProps: {
      value: {
        handleDeleteSelection, handleEntryPointerCore, handleBulkSelectionReanalyze,
        selectionValue: selectionState,
        handleDocumentDragStart, handleDocumentDragEnd, draggedDocumentIds,
        handleDocumentTitleUpdate, handleDocumentIssuedUpdate,
        handleDocumentTagAdd, handleDocumentTagAttach, handleDocumentTagDetach,
        openDocumentViewerForDetail, viewerActive, viewerDocumentId,
        closeDocumentViewer, viewerReturnPath, ensureAssetUrl, getDocumentAsset,
        detailPanelProps, detailPanelOpen, openDetailPanel, closeDetailPanel,
      },
      selection: {
        selectedEntries, selectedDocumentIds, setSelectedEntries, setSelectionOrder,
        selectionOrderRef, selectionAnchorRef, setFocusedDocumentId, focusedDocumentId,
        setFocusedEntryKey, focusedEntryKey, selectionInitializedRef,
        activeViewerId, setActiveViewerId, configureSelectionEnvironment,
        promoteSelectionOrderRaw, clearSelection,
      },
    },

    // SessionProvider
    onDocumentsViewModeChange: handleDocumentsViewModeChange,
  };
};

export default useDocumentsWorkspace;
