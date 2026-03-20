import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import useFolderTreeHook from '../../documents/features/folders/useFolderTree';
import { resolveBreadcrumbs } from '../../documents/logic/breadcrumbs';
import { listFolderContents } from '../api/apiClient';
import { useStatusToast } from './StatusToastContext';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import {
  createDocumentEntryKey,
  createFolderEntryKey,
  isFolderEntry,
  isDocumentEntry,
} from '../../app/entryKey';
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentId, FolderNodeId, Identifier } from '../../types/identifiers';
import { getVisibleSubfolders } from '../../documents/logic/folderUtils';
import type { Document, Folder, FolderNode } from '../../types/documents';
import type FoldersManager from '../../documents/FoldersManager';
import type { BreadcrumbEntry, FolderOption } from './FolderTreeContext';

export interface FolderContextValue {
  foldersManager: FoldersManager;
  folderNodes: Map<FolderNodeId, FolderNode>;
  selectedFolder: FolderNodeId;
  setSelectedFolder: Dispatch<SetStateAction<FolderNodeId>>;
  currentFolderName: string;
  folderOptions: FolderOption[];
  isInvalidFolderDrop: (sourceId: FolderNodeId | null, targetId: FolderNodeId | null) => boolean;
  visibleSubfolders: Folder[];
  resolveFolderPath: (folderId?: FolderNodeId) => BreadcrumbEntry[];
  breadcrumbs: BreadcrumbEntry[];
  refreshCurrentFolder: () => Promise<void>;
  /** Fetch + apply folder contents for a given folder id */
  fetchFolderData: (folderId: FolderNodeId, options?: { includeDocuments?: boolean }) => Promise<{ data: any; includeDocuments: boolean }>;
  /** Apply fetched folder data to documents + selection state */
  updateViewState: (folderId: FolderNodeId, data: any, includeDocuments: boolean) => void;
}

const [FolderCtx, useFolder] = createSafeContext<FolderContextValue>('Folder');

interface FolderProviderProps {
  foldersManager: FoldersManager;
  foldersSnapshot: Map<string, Folder>;
  /** External selectedFolder state (owned by useDocumentsWorkspace) */
  selectedFolder: FolderNodeId;
  setSelectedFolder: Dispatch<SetStateAction<FolderNodeId>>;
  documentsSortField: string;
  documentsSortDirection: string;
  /** Cross-domain writers — folder fetch updates documents + selection */
  setDocuments: Dispatch<SetStateAction<Document[]>>;
  setSelectedEntries: Dispatch<SetStateAction<string[]>>;
  children: React.ReactNode;
}

export const FolderProvider: React.FC<FolderProviderProps> = ({
  foldersManager,
  foldersSnapshot,
  selectedFolder: externalSelectedFolder,
  setSelectedFolder: externalSetSelectedFolder,
  documentsSortField,
  documentsSortDirection,
  setDocuments,
  setSelectedEntries,
  children,
}) => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const folderState = useFolderTreeHook({
    foldersManager,
    externalSelectedFolder,
    externalSetSelectedFolder,
  });
  const {
    folderNodes,
    selectedFolder,
    setSelectedFolder,
    isInvalidFolderDrop,
    currentFolderName,
    folderOptions,
  } = folderState;

  // --- Derived state ---

  const visibleSubfolders = useMemo(
    () => getVisibleSubfolders(foldersSnapshot, selectedFolder),
    [foldersSnapshot, selectedFolder],
  );

  const resolveFolderPath = useCallback(
    (folderId) => resolveBreadcrumbs(folderId || 'root', folderNodes as any),
    [folderNodes],
  );

  const breadcrumbs = useMemo(
    () => resolveBreadcrumbs(selectedFolder || 'root', folderNodes as any),
    [selectedFolder, folderNodes],
  );

  // --- Data fetching ---

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
      if (folderId === selectedFolderRef.current) {
        if (includeDocuments) {
          setDocuments((data.documents || []) as Document[]);
        }
        const subfolders = (data.subfolders || []) as any[];
        foldersManager.ingest(subfolders);
        if (includeDocuments) {
          setSelectedEntries((prev) =>
            reconcileSelectionWithFolderData(
              prev,
              (data.documents || []) as Document[],
              subfolders,
            ),
          );
        }
      }
    },
    [setDocuments, setSelectedEntries, reconcileSelectionWithFolderData, selectedFolderRef, foldersManager],
  );

  const fetchFolderData = useCallback(
    async (folderId: FolderNodeId, options: { includeDocuments?: boolean } = {}) => {
      const path = folderId === 'root' ? 'root' : folderId;
      const includeDocuments = options.includeDocuments ?? true;
      const params: Record<string, unknown> = {
        include_documents: includeDocuments,
        sort: documentsSortField,
        dir: documentsSortDirection,
      };
      const data = await listFolderContents(path, params);
      return { data, includeDocuments };
    },
    [documentsSortField, documentsSortDirection],
  );

  // Auto-fetch when selectedFolder or sort changes.
  // Guard against stale responses: if the user navigates folders quickly, earlier responses
  // that arrive after the cleanup runs are silently discarded.
  useEffect(() => {
    if (!selectedFolder) return;

    let stale = false;
    fetchFolderData(selectedFolder)
      .then(({ data, includeDocuments }) => {
        if (!stale) {
          updateViewState(selectedFolder, data, includeDocuments);
        }
      })
      .catch((error) => {
        if (!stale) {
          notifyApiError(error, 'Failed to fetch folder contents');
        }
      });

    return () => { stale = true; };
  }, [selectedFolder, documentsSortField, documentsSortDirection, fetchFolderData, updateViewState, notifyApiError]);

  const handleManualRefresh = useCallback(async () => {
    if (!selectedFolder) return;
    try {
      const { data, includeDocuments } = await fetchFolderData(selectedFolder);
      updateViewState(selectedFolder, data, includeDocuments);
      showToast('Folder refreshed successfully', 'success');
    } catch (error) {
      notifyApiError(error, 'Failed to refresh folder');
    }
  }, [selectedFolder, fetchFolderData, updateViewState, showToast, notifyApiError]);

  const value: FolderContextValue = {
    foldersManager,
    folderNodes,
    selectedFolder,
    setSelectedFolder: folderState.setSelectedFolder,
    currentFolderName,
    folderOptions,
    isInvalidFolderDrop,
    visibleSubfolders,
    resolveFolderPath,
    breadcrumbs,
    refreshCurrentFolder: handleManualRefresh,
    fetchFolderData,
    updateViewState,
  };

  return <FolderCtx.Provider value={value}>{children}</FolderCtx.Provider>;
};

export { useFolder };
