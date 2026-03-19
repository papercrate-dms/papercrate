import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  useLocation,
  useMatch,
  useNavigate,
  useParams,
} from 'react-router-dom';
import AssetManager, { getAssetFromVersion } from '../../lib/assets/AssetManager';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import TagManager from '../../lib/assets/TagManager';
import CorrespondentManager from '../../lib/assets/CorrespondentManager';
import { fetchAsset } from '../../lib/api/apiClient';
import { useEntryPointer as useEntryPointerCore } from '../features/selection/useEntryPointer';
import useDocumentsSelection from '../features/selection/useDocumentsSelection';
import useBulkDocumentActions from './useBulkDocumentActions';
import {
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_FIELD,
  mergeAssetIntoDocument,
} from '../../app/workspaceUtils';
import {
  createDocumentEntryKey,
  createFolderEntryKey,
  isFolderEntry,
  isDocumentEntry
} from '../../app/entryKey';
import useDocumentsSearch from '../../app/useDocumentsSearch';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import useAuthManager from './useAuthManager';
import useTenantManager from './useTenantManager';
import useDocuments from './useDocuments';
import FoldersManager from '../FoldersManager';
import { fetchDocument } from '../../lib/api/apiClient';
import useFolderTree from '../features/folders/useFolderTree';
import useFolderTreeActions from '../features/folders/useFolderTreeActions';
import useDocumentUploads from '../features/upload/useDocumentUploads';
import useDocumentDragHandlers from '../features/upload/useDocumentDragHandlers';
import useDocumentMutations from './useDocumentMutations';
import useDetailWorkspace from '../../viewer/logic/useDetailWorkspace';
import useTags from './useTags';
import useCorrespondents from './useCorrespondents';
import usePasskeys from '../../settings/usePasskeys';
import { resolveBreadcrumbs } from '../logic/breadcrumbs';
import useWorkspaceSelectionSync from '../features/selection/useWorkspaceSelectionSync';
import useWorkspaceViewData from './useWorkspaceViewData';
import { useManagementModals } from '../../app/useManagementModals';
import { useAppDispatch, useAppState } from '../../lib/store/appState';
import { listFolderContents } from '../../lib/api/apiClient';
import { useApi } from '../../lib/context/ApiContext';
import { useWorkspaceSelection } from '../../app/useWorkspaceSelection';
import useDocumentViewer from '../../app/useDocumentViewer';
import type { DocumentId, FolderNodeId, Identifier } from '../../types/identifiers';
import type { Document, Folder } from '../../types/documents';
import { EntryType } from '../../constants/documents';
import type { SessionContextValue } from '../../lib/context/SessionContext';
import type { UIContextValue } from '../../lib/context/UIContext';
import type { TagsContextValue } from '../../lib/context/TagsContext';
import type { CorrespondentsContextValue } from '../../lib/context/CorrespondentsContext';
import type { FolderTreeContextValue } from '../../lib/context/FolderTreeContext';
import type { DocumentsSearchContextValue } from '../../lib/context/DocumentsSearchContext';
import type { DocumentsWorkspaceContextValue } from '../../lib/context/DocumentsWorkspaceContext';

const noop = () => { };

interface TenantOption {
  id?: Identifier | null;
  name?: string | null;
  slug?: string | null;
  [key: string]: unknown;
}

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

  const activeSortFieldRef = useRef(documentsSortField);
  useEffect(() => {
    activeSortFieldRef.current = documentsSortField;
  }, [documentsSortField]);

  const activeSortDirectionRef = useRef(documentsSortDirection);
  useEffect(() => {
    activeSortDirectionRef.current = documentsSortDirection;
  }, [documentsSortDirection]);

  const navigate = useNavigate();
  const location = useLocation();
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const params = useParams<{ folderId?: string; documentId?: string }>();
  const isTrashRoute = useMatch('/trash') !== null;
  const routeFolderId = isTrashRoute ? 'trash' : (params.folderId || null);
  const routeDocumentId = params.documentId || null;
  const viewerDocumentId = routeDocumentId;

  const handleBreadcrumbNavigate = useCallback((crumb: { id?: Identifier | string } | null) => {
    if (!crumb || !crumb.id) {
      return;
    }
    const target = crumb.id === 'root' ? '/folders' : `/folders/${crumb.id}`;
    navigate(target);
  }, [navigate]);

  const {
    status: appStatus,
    token,
    tenant,
    tenants: tenantOptionsRaw = [],
  } = appState;
  const { client: apiClient } = useApi();

  const tenantRecord = (tenant ?? null) as TenantOption | null;
  const currentTenantId: Identifier | null = (tenantRecord?.id ?? null) as Identifier | null;

  const tenantOptions: TenantOption[] = Array.isArray(tenantOptionsRaw)
    ? (tenantOptionsRaw as TenantOption[])
    : [];
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const { handleLogout } = useAuthManager({});

  const tenantIdRef = useRef(currentTenantId);
  const detailPanelControlRef = useRef({ open: () => { }, close: () => { } });
  const isWorkspaceRoute = location.pathname.startsWith('/folders') || location.pathname === '/trash';

  const [draggedDocumentIds, setDraggedDocumentIds] = useState<DocumentId[]>([]);
  const [draggedFolderId, setDraggedFolderId] = useState<FolderNodeId | null>(null);
  const [activeViewerId, setActiveViewerId] = useState<DocumentId | null>(routeDocumentId || null);
  const shellRef = useRef(null);
  const assetManagerRef = useRef(null);
  if (!assetManagerRef.current) {
    const fetcher = async (id: Identifier) => {
      const asset = await fetchAsset(id);
      return (asset as unknown) as any;
    };
    assetManagerRef.current = new AssetManager({ fetchAsset: fetcher });
  }
  const assetManager = assetManagerRef.current;

  const extractDocumentFromResponse = useCallback(
    (payload) => {
      if (!payload) {
        return null;
      }
      return payload.document || payload;
    },
    [],
  );

  const fetchDocumentById = useCallback(
    async (documentId: DocumentId) => {
      if (!documentId) {
        return null;
      }
      const data = await fetchDocument(documentId);
      return extractDocumentFromResponse(data);
    },
    [extractDocumentFromResponse],
  );

  const tagManagerRef = useRef(null);
  if (!tagManagerRef.current) {
    tagManagerRef.current = new TagManager();
  }
  const tagManager = tagManagerRef.current;

  const correspondentManagerRef = useRef<CorrespondentManager | null>(null);
  if (!correspondentManagerRef.current) {
    correspondentManagerRef.current = new CorrespondentManager();
  }
  const correspondentManager = correspondentManagerRef.current;

  const selectionState = useWorkspaceSelection();

  const {
    selectedEntries,
    selectedDocumentIds,
    selectedFolderIds,
    setSelectedEntries,
    setSelectionOrder,
    selectionOrderRef,
    selectionAnchorRef,
    selectionInitializedRef,
    focusedDocumentId,
    setFocusedDocumentId,
    focusedEntryKey,
    setFocusedEntryKey,
    applySelection,
    handleEntrySelection,
    clearSelection,
    promoteSelectionOrder: promoteSelectionOrderRaw,
    configureSelectionEnvironment,
  } = selectionState;

  const {
    documents,
    setDocuments,
    documentsManager,
  } = useDocuments({
    fetchDocumentById,
  });

  useEffect(() => {
    if (tagManager) {
      documentsManager.setTagManager(tagManager);
    }
    if (correspondentManager) {
      documentsManager.setCorrespondentManager(correspondentManager);
    }
  }, [documentsManager, tagManager, correspondentManager]);

  const documentLookup = useSyncExternalStore(
    (onStoreChange) => documentsManager.subscribe(onStoreChange),
    () => documentsManager.getSnapshot(),
    () => documentsManager.getSnapshot(),
  );

  const foldersManagerRef = useRef<FoldersManager | null>(null);
  if (!foldersManagerRef.current) {
    foldersManagerRef.current = new FoldersManager();
  }
  const foldersManager = foldersManagerRef.current;

  const folderStateRaw = useFolderTree({
    initialSelectedFolder: routeFolderId || 'root',
    foldersManager,
  });
  const {
    folderNodes,
    selectedFolder,
    setSelectedFolder,
    currentFolderName,
    folderOptions,
    isInvalidFolderDrop,
  } = folderStateRaw;

  const folderState = {
    ...folderStateRaw,
    setCreatingFolder,
    foldersManager,
  };

  const resolveFolderPath = useCallback(
    (folderId) => {
      return resolveBreadcrumbs(folderId || 'root', folderNodes as any);
    },
    [folderNodes],
  );

  const foldersSnapshot = useSyncExternalStore(
    useCallback((cb) => foldersManager.subscribe(cb), [foldersManager]),
    () => foldersManager.getSnapshot(),
    () => foldersManager.getSnapshot(),
  );

  const visibleSubfolders = useMemo(() => {
    // Derive subfolders directly from the source of truth (FoldersManager)
    const currentId = selectedFolder || 'root';
    const allFolders = Array.from(foldersSnapshot.values());

    return allFolders.filter((folder: Folder) => {
      const parentId = folder.parent_id || 'root';
      return parentId === currentId;
    });
  }, [foldersSnapshot, selectedFolder]);

  const reconcileSelectionWithFolderData = useCallback(
    (currentSelection: string[], docs: Document[], subfolders: any[]) => {
      const availableDocKeys = docs
        .map((doc) => createDocumentEntryKey(doc?.id as Identifier))
        .filter(Boolean);
      const availableDocKeySet = new Set(availableDocKeys);
      const availableFolderKeys = new Set(
        subfolders
          .map((folder) => createFolderEntryKey(folder?.id as Identifier))
          .filter(Boolean),
      );

      const previousFolderKeys = currentSelection
        .filter(isFolderEntry)
        .filter((key) => availableFolderKeys.has(key));
      const previousDocKeys = currentSelection.filter(isDocumentEntry);
      const nextDocKeys = previousDocKeys.filter((key) => availableDocKeySet.has(key));
      return [...previousFolderKeys, ...nextDocKeys];
    },
    [],
  );

  const selectedFolderRef = useRef<FolderNodeId>(selectedFolder);
  useEffect(() => {
    selectedFolderRef.current = selectedFolder;
  }, [selectedFolder]);

  const updateViewState = useCallback(
    (folderId: FolderNodeId, data: any, includeDocuments: boolean) => {
      // Guard against race conditions: only update if the folder is still selected
      if (folderId === selectedFolderRef.current) {
        if (includeDocuments) {
          setDocuments((data.documents || []) as Document[]);
        }

        const subfolders = (data.subfolders || []) as any[];
        foldersManager.ingest(subfolders);

        if (includeDocuments) {
          setSelectedEntries((prev) => reconcileSelectionWithFolderData(
            prev,
            (data.documents || []) as Document[],
            (data.subfolders || []) as any[]
          ));
        }
      }
    },
    [
      setDocuments,
      setSelectedEntries,
      reconcileSelectionWithFolderData,
      selectedFolderRef,
      foldersManager,
    ]
  );

  const fetchFolderData = useCallback(
    async (
      folderId: FolderNodeId,
      options: { includeDocuments?: boolean } = {}
    ) => {
      const path = folderId === 'root' ? 'root' : folderId;
      const includeDocuments = options.includeDocuments ?? true;
      const params: Record<string, unknown> = {
        include_documents: includeDocuments,
        sort: activeSortFieldRef.current,
        dir: activeSortDirectionRef.current,
      };

      const data = await listFolderContents(path, params);
      return { data, includeDocuments };
    },
    [
      activeSortFieldRef,
      activeSortDirectionRef,
    ]
  );

  useEffect(() => {
    if (selectedFolder) {
      fetchFolderData(selectedFolder)
        .then(({ data, includeDocuments }) => {
          updateViewState(selectedFolder, data, includeDocuments);
        })
        .catch((error) => {
          notifyApiError(error, 'Failed to fetch folder contents');
        });
    }
  }, [selectedFolder, documentsSortField, documentsSortDirection, fetchFolderData, updateViewState, notifyApiError]);

  const documentsSearch = useDocumentsSearch({
    api: apiClient,
    selectedFolder,
    locationPathname: location.pathname,
    isWorkspaceRoute,
    searchIncludeDescendants,
    documentsSortField,
    documentsSortDirection,
    setSearchIncludeDescendants,
    documentsManager,
  });

  const showingSearchResults = documentsSearch.searchResultIds !== null;

  const {
    viewDocuments,
    visibleEntryKeySet,
  } = useWorkspaceViewData({
    documents,
    documentLookup,
    searchResultIds: documentsSearch.searchResultIds,
    showingSearchResults,
    currentSubfolders: visibleSubfolders,
    selectedFolder: selectedFolder,
  });

  const {
    openDocumentViewer,
    closeDocumentViewer,
    resetViewerState,
    viewerWorkspaceDocument,
    viewerActive,
  } = useDocumentViewer({
    routeDocumentId: viewerDocumentId,
    documentsManager,
    selectedFolder,
    locationPathname: location.pathname,
    locationSearch: location.search,
    detailPanelControlRef,
    setActiveViewerId,
  });

  const openDocumentViewerForDetail = useCallback(
    ({ documentIds }: { documentIds?: Identifier[] } = {}) => {
      const targetId = documentIds?.find((value): value is Identifier => value != null);
      if (targetId == null) {
        return;
      }
      openDocumentViewer(targetId, { replace: true });
    },
    [openDocumentViewer],
  );

  const getDocumentAsset = useCallback((doc, type) => {
    if (!doc || !type) return null;
    return getAssetFromVersion(doc.current_version || null, type);
  }, []);

  const bootstrapInitializedRef = useRef(false);


  useWorkspaceSelectionSync({
    showingSearchResults,
    searchQuery: documentsSearch.searchQuery,
    setSelectedEntries,
    setSelectionOrder,
    selectionOrderRef,
    selectionAnchorRef,
    setFocusedDocumentId,
    selectedDocumentIds,
    activeViewerId,
    setActiveViewerId,
    selectionInitializedRef,
  });

  const tagsState = useTags({
    tenantIdRef,
    tagManager,
    setActiveTagFilters: documentsSearch.setActiveTagFilters,
    documentsManager,
  });

  // Correspondents state
  const correspondentsState = useCorrespondents({
    correspondentManager,
    documentsManager,
  });

  const { refreshTags } = tagsState;
  const { refreshCorrespondents } = correspondentsState;

  // Prefetch tags/correspondents when tenant changes
  useEffect(() => {
    refreshTags();
    refreshCorrespondents();
  }, [refreshTags, refreshCorrespondents, currentTenantId]);

  const passkeys = usePasskeys({});

  const resolveTargetDocumentIds = useCallback(
    (candidateIds) => {
      const normalized = Array.isArray(candidateIds)
        ? candidateIds.filter(Boolean)
        : [];
      if (normalized.length) {
        return Array.from(new Set(normalized));
      }
      return selectedDocumentIds;
    },
    [selectedDocumentIds],
  );

  const refreshFolderData = useCallback(async () => {
    if (selectedFolder) {
      const { data, includeDocuments } = await fetchFolderData(selectedFolder);
      updateViewState(selectedFolder, data, includeDocuments);
    }
  }, [selectedFolder, fetchFolderData, updateViewState]);

  const handleManualRefresh = useCallback(async () => {
    try {
      await refreshFolderData();
      showToast('Folder refreshed successfully', 'success');
    } catch (error) {
      showToast('Failed to refresh folder', 'error');
      console.error('Failed to refresh folder:', error);
    }
  }, [refreshFolderData, showToast]);

  const upload = useDocumentUploads({
    selectedFolder,
    currentFolderName,
    refreshCurrentFolder: refreshFolderData,
    shellRef,
  });

  const {
    handleDocumentDragStart,
    handleDocumentDragEnd,
    handleFolderDragStart,
    handleFolderDragEnd,
  } = useDocumentDragHandlers({
    documentLookup,
    setDraggedDocumentIds,
    setDraggedFolderId,
    documentsViewMode,
    selectedEntries,
    selectedDocumentIds,
    selectedFolderIds,
    applySelection,
    handleEntrySelection,
  });

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
    documentsSearch.setSearchResultIds(null);
    documentsSearch.setSearchQuery('');
    documentsSearch.setActiveTagFilters([]);
    documentsSearch.setActiveCorrespondentFilters([]);
    setActiveViewerId(null);
    detailPanelControlRef.current.close();
    assetManager.reset();
    resetViewerState();
    upload.resetUploadsState();
    upload.clearUploadQueue();

    bootstrapInitializedRef.current = false;
    selectionInitializedRef.current = false;
    tenantIdRef.current = null;
  }, [
    assetManager,
    selectionAnchorRef,
    selectionInitializedRef,
    selectionOrderRef,
    setFocusedDocumentId,
    setSelectedEntries,
    setSelectionOrder,
    setSelectedFolder,
    setDocuments,
    setDraggedDocumentIds,
    setDraggedFolderId,
    documentsSearch,
    setActiveViewerId,
    resetViewerState,
    upload,
  ]);

  // Use a ref to hold the latest resetWorkspaceState to avoid triggering the effect below
  // when resetWorkspaceState changes (which happens on every render due to dependencies).
  const resetWorkspaceStateRef = useRef(resetWorkspaceState);
  useEffect(() => {
    resetWorkspaceStateRef.current = resetWorkspaceState;
  });

  useEffect(() => {
    if (appStatus === 'logged-out' || appStatus === 'selecting-tenant') {
      resetWorkspaceStateRef.current();
    }
  }, [appStatus]);

  const documentsState = {
    documentLookup,
    setDocuments,
    setSearchResultIds: documentsSearch.setSearchResultIds,
    documentsManager,
    extractDocumentFromResponse,
    ingestDocuments: (docs: unknown[]) => documentsManager.ingest(docs),
  };

  const documentMutationsResult = useDocumentMutations({
    documentsState,
    folderState,
    selectionState,
    tagsState,
    correspondentsState,
    closeDocumentViewer,
    viewerDocumentId,
    resolveTargetDocumentIds,
  });

  const {
    moveDocumentsToFolder,
    handleDocumentsDelete,
    handleDocumentTagAdd,
    handleDocumentTagAttach,
    handleDocumentTitleUpdate,
    handleDocumentIssuedUpdate,
    handleDocumentTagDetach,
    handleDocumentCorrespondentAttach,
    handleDocumentCorrespondentDetach,
    handleDocumentCorrespondentAdd,
    handleBulkCorrespondentAdd,
    handleBulkCorrespondentRemove,
    handleBulkTagAddFromDetail,
    handleBulkTagRemoveFromDetail,
    handleBulkSelectionReanalyze,
  } = documentMutationsResult;

  // Wait, mutations object is line 663. handleDeleteSelection is defined later (line 787). 
  // This ordering is problematic if mutations is used before.

  const dragState = {
    draggedDocumentIds,
    draggedFolderId,
    setDraggedDocumentIds,
    setDraggedFolderId,
  };

  const folderActions = useFolderTreeActions({
    folderState,
    dragState,
    actions: {
      handleFileDrop: upload.handleFileDrop,
      moveDocumentsToFolder,
    },
    utils: {
      isInvalidFolderDrop,
    },
  });

  const {
    loadFolder,
    selectFolder,
    handleFolderCreate,
    handleFolderDelete,
  } = folderActions;

  const selectionContext = useDocumentsSelection({
    showingSearchResults,
    currentSubfolders: visibleSubfolders,
    visibleDocuments: viewDocuments,
    configureSelectionEnvironment,
    visibleEntryKeySet,
    selectedEntries,
    selectionAnchorRef,
    promoteSelectionOrderRaw,
    setFocusedDocumentId,
    setActiveViewerId,
    clearSelection,
    focusedDocumentId,
    setFocusedEntryKey,
    focusedEntryKey,
  });

  const initializeAfterLogin = useCallback(async () => {
    await Promise.all([
      refreshTags(),
      refreshCorrespondents(),
      foldersManager.ensureTree(),
    ]);
    const initialFolder = routeFolderId && routeFolderId !== 'root' ? routeFolderId : 'root';
    await loadFolder(initialFolder, {});
  }, [refreshTags, refreshCorrespondents, routeFolderId, loadFolder, foldersManager]);

  useEffect(() => {
    if (!token) {
      return;
    }
    if (appStatus !== 'ready') {
      return;
    }

    const targetParam = routeFolderId ?? 'root';

    if (targetParam === 'root' && routeDocumentId) {
      return;
    }

    // Checking cache (folderContents) is removed, now we rely on selectedFolder effect to fetch.
    if (targetParam !== selectedFolder) {
      selectFolder(targetParam, { immediate: true });
    }
  }, [
    token,
    appStatus,
    routeFolderId,
    routeDocumentId,
    selectedFolder,
    selectFolder,
  ]);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (appStatus !== 'authenticated') {
      return;
    }
    if (bootstrapInitializedRef.current) {
      return;
    }

    const bootstrap = async () => {
      bootstrapInitializedRef.current = true;
      appDispatch({ type: 'BOOTSTRAP_START' });
      try {
        await initializeAfterLogin();
        if (mountedRef.current) {
          appDispatch({ type: 'BOOTSTRAP_SUCCESS' });
        }
      } catch (error) {
        if (mountedRef.current) {
          appDispatch({
            type: 'BOOTSTRAP_FAILURE',
            error: error?.message || 'Failed to initialize data.',
          });
          bootstrapInitializedRef.current = false;
        }
      }
    };

    bootstrap();
  }, [appStatus, appDispatch, initializeAfterLogin]);

  const {
    handleDeleteSelection,
  } = useBulkDocumentActions({
    selectedDocumentIds,
    selectedFolderIds,
    handleDocumentsDelete,
    handleFolderDelete,
    clearDocumentSelection: selectionContext.clearDocumentSelection,
  });

  const ensureAssetUrl = useCallback(
    async (documentId, asset, { force = false } = {}) => {
      if (!documentId || !asset?.id) {
        return null;
      }

      try {
        const entry = await assetManager.ensureAsset(documentId, asset, {
          force,
        });

        if (!entry) {
          return null;
        }

        documentsManager.update(documentId, (doc) => mergeAssetIntoDocument(doc, entry));

        return entry;
      } catch (error) {
        notifyApiError(error, 'Unable to refresh document asset.');
        throw error;
      }
    },
    [assetManager, documentsManager, notifyApiError],
  );

  const handlePromptCreateFolder = useCallback(async (parentId?: Identifier | null) => {
    if (creatingFolder) {
      return;
    }
    const input = window.prompt('New folder name');
    if (!input) {
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) {
      showToast('Folder name cannot be empty.', 'error');
      return;
    }
    setCreatingFolder(true);
    try {
      const success = await handleFolderCreate(trimmed, parentId);
      if (!success) {
        showToast('Unable to create folder. Check the status message for details.', 'error');
      }
    } finally {
      setCreatingFolder(false);
    }
  }, [creatingFolder, handleFolderCreate, showToast]);

  const { managementModals, openTagsModal, openCorrespondentsModal } = useManagementModals({
    locationPathname: location.pathname,
    tags: tagsState.tags,
    refreshTags: tagsState.refreshTags,
    onTagCreate: tagsState.handleTagCreate,
    onTagUpdate: async (tagId: string, changes: any) => { await tagsState.handleTagUpdate(tagId, changes); },
    onTagDelete: async (tagId: string) => { await tagsState.handleTagDelete(tagId); },
    correspondents: correspondentsState.correspondents,
    correspondentLookupById: correspondentsState.correspondentLookupById,
    correspondentLookupByName: correspondentsState.correspondentLookupByName,
    refreshCorrespondents,
    onCorrespondentCreate: correspondentsState.handleCorrespondentCreate,
    onCorrespondentUpdate: correspondentsState.handleCorrespondentUpdate,
    onCorrespondentDelete: correspondentsState.handleCorrespondentDelete,
    correspondentManager,
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  const detailWorkspace = useDetailWorkspace({
    folderNodes,
    detailPanelControlRef,
    openDocumentViewer: openDocumentViewerForDetail,
    handleDocumentTitleUpdate,
    handleDocumentIssuedUpdate,
    handleDocumentTagAdd,
    handleDocumentTagDetach,
    ensureAssetUrl,
    getAsset: getDocumentAsset,
    correspondents: correspondentsState.correspondents,
    handleCorrespondentAdd: handleDocumentCorrespondentAdd,
    handleCorrespondentRemove: handleDocumentCorrespondentDetach,
    selectFolder,
    tags: tagsState.tags,
    tagLookupById: tagsState.tagLookupById,
    correspondentLookupById: correspondentsState.correspondentLookupById,
    resolveFolderPath,
  });



  const handleEntryPointerCore = useEntryPointerCore({
    onSelectEntry: (entry, event, { rowKey, modifierClick, primaryClick }) => {
      const { type, id } = entry;
      const key = rowKey
        || (type === EntryType.document ? createDocumentEntryKey(id) : createFolderEntryKey(id));
      if (key) {
        if (documentsViewMode === 'grid' && (event as any).shiftKey) {
          // Additive selection for Shift+Click in Grid View
          const newSelection = Array.from(new Set([...selectedEntries, key]));
          applySelection(newSelection, { anchor: key, interactedKeys: [key] });
        } else {
          handleEntrySelection(key, event);
        }
      }
      if (type === EntryType.folder && !modifierClick && primaryClick) {
        selectFolder(id);
      }
    },
  });

  const breadcrumbs = useMemo(() => {
    return resolveBreadcrumbs(selectedFolder || 'root', folderNodes as any);
  }, [selectedFolder, folderNodes]);

  const { handleTenantSelect } = useTenantManager({
    currentTenantId,
    handleDocumentsViewModeChange,
  });

  // --- Domain context values (typed) ---

  const sessionDomain: SessionContextValue = {
    token,
    appStatus,
    handleLogout,
    tenant: tenantRecord,
    tenants: tenantOptions,
    tenantOptions,
    handleTenantSelect,
    passkeys,
  };

  const uiDomain: UIContextValue = {
    notifyApiError,
    settingsOpen,
    openSettings,
    closeSettings,
    managementModals,
    refreshCurrentFolder: handleManualRefresh,
    handleFileSelection: upload.handleFileSelection,
    handleFileDrop: upload.handleFileDrop,
    uploadQueue: upload.uploadQueue,
    clearUploadQueue: upload.clearUploadQueue,
    dropOverlayState: upload.dropOverlayState,
    resetUploadsState: upload.resetUploadsState,
  };

  const tagsDomain: TagsContextValue = {
    ...tagsState,
    tagManager,
    activeTagFilters: documentsSearch.activeTagFilters,
    handleDocumentTagAttach,
    handleDocumentTagDetach,
    handleBulkTagAddFromDetail,
    handleBulkTagRemoveFromDetail,
    openTagsModal,
  };

  const correspondentsDomain: CorrespondentsContextValue = {
    ...correspondentsState,
    activeCorrespondentFilters: documentsSearch.activeCorrespondentFilters,
    handleDocumentCorrespondentAttach,
    handleDocumentCorrespondentDetach,
    handleDocumentCorrespondentAdd,
    handleBulkCorrespondentAdd,
    handleBulkCorrespondentRemove,
    openCorrespondentsModal,
  };

  const folderTreeDomain: FolderTreeContextValue = {
    foldersManager,
    selectedFolder,
    currentFolderName,
    folderOptions,
    handleBreadcrumbNavigate,
    resolveFolderPath,
    selectFolder: folderActions.selectFolder,
    moveDocumentsToFolder,
    folderClickHandlers: folderActions.folderClickHandlers,
    handleFolderRename: folderActions.handleFolderRename,
    handleFolderDelete: folderActions.handleFolderDelete,
    handleFolderDragStart,
    handleFolderDragEnd,
    draggedFolderId,
    handlePromptCreateFolder,
    creatingFolder,
    currentSubfolders: visibleSubfolders,
    breadcrumbs,
    refreshCurrentFolder: handleManualRefresh,
  };

  const searchDomain: DocumentsSearchContextValue = {
    searchQuery: documentsSearch.searchQuery,
    searchLoading: documentsSearch.searchLoading,
    documentsViewMode,
    handleDocumentsViewModeChange,
    documentsSortField,
    documentsSortDirection,
    handleDocumentsSortFieldChange,
    handleDocumentsSortDirectionToggle,
    searchResultIds: documentsSearch.searchResultIds,
    documents: viewDocuments,
    documentsFilter: documentsSearch.documentsFilterValue,
    documentsManager,
    documentLookup,
  };

  const workspaceDomain: DocumentsWorkspaceContextValue = {
    // Selection
    clearDocumentSelection: selectionContext.clearDocumentSelection,
    handleDeleteSelection,
    handleEntryPointerCore,
    handleBulkSelectionReanalyze,
    selectionValue: selectionState,
    // Mutations
    handleDocumentDragStart,
    handleDocumentDragEnd,
    draggedDocumentIds,
    handleDocumentTitleUpdate: handleDocumentTitleUpdate,
    handleDocumentTagAttach,
    handleDocumentTagDetach,
    // Preview / viewer
    openDocumentViewerForDetail,
    viewerActive,
    viewerWorkspaceDocument,
    viewerDocumentId,
    closeDocumentViewer,
    ensureAssetUrl,
    getDocumentAsset,
    // Detail panel
    detailPanelProps: detailWorkspace.detailPanelProps,
    detailPanelOpen: detailWorkspace.detailPanelOpen,
    openDetailPanel: detailWorkspace.openDetailPanel,
    closeDetailPanel: detailWorkspace.closeDetailPanel,
  };

  const domains = {
    session: sessionDomain,
    ui: uiDomain,
    tags: tagsDomain,
    correspondents: correspondentsDomain,
    folderTree: folderTreeDomain,
    search: searchDomain,
    workspace: workspaceDomain,
  };

  // hook callers handle rendering / routing
  return {
    appStatus,
    location,
    shellRef,
    dropOverlayState: upload.dropOverlayState,
    managementModals,
    domains,
    settingsOpen,
    closeSettings,
  };
};

export default useDocumentsWorkspace;
