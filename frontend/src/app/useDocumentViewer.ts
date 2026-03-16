import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { DocumentId } from '../types/identifiers';

type FolderId = DocumentId | 'root';

import type { Document } from '../types/documents';
import useNotifyApiError from '../hooks/useNotifyApiError';

interface UseDocumentViewerArgs {
  routeDocumentId?: DocumentId | null;
  documentsManager: {
    getById: (id: DocumentId) => Document | null;
    ensure: (id: DocumentId) => Promise<Document | null>;
    getMany: (ids: DocumentId[]) => Document[];
    subscribe: (listener: () => void) => () => void;
    ingest: (docs: unknown[]) => { canonical: Document[]; changed: boolean };
  };
  selectedFolder?: FolderId | null;
  locationPathname: string;
  locationSearch: string;
  detailPanelControlRef: MutableRefObject<{
    open?: (args?: { documentIds?: DocumentId[] }) => void;
    close?: () => void;
  } | null>;
  setActiveViewerId: Dispatch<SetStateAction<DocumentId | null>>;
}

interface UseDocumentViewerResult {
  ensureViewerData: (documentId: DocumentId) => Promise<Document | null>;
  openDocumentViewer: (documentId: DocumentId, options?: { replace?: boolean }) => void;
  closeDocumentViewer: (folderId?: FolderId) => void;
  resetViewerState: () => void;
  viewerWorkspaceDocument: Document | null;
  viewerActive: boolean;
}

const useDocumentViewer = ({
  routeDocumentId,
  documentsManager,
  selectedFolder,
  locationPathname,
  locationSearch,
  detailPanelControlRef,
  setActiveViewerId,
}: UseDocumentViewerArgs): UseDocumentViewerResult => {
  const viewerReturnPathRef = useRef<string | null>(null);
  const notifyApiError = useNotifyApiError();
  const navigate = useNavigate();

  const resetViewerState = useCallback(() => {
    viewerReturnPathRef.current = null;
  }, []);

  const ensureViewerData = useCallback(
    async (documentId: DocumentId): Promise<Document | null> => {
      if (!documentId) return null;

      const doc = await documentsManager.ensure(documentId);

      if (!doc) {
        throw new Error('Document metadata unavailable.');
      }

      if (!viewerReturnPathRef.current) {
        const fallbackFolderId = doc?.folder_id || 'root';
        viewerReturnPathRef.current =
          fallbackFolderId === 'root' ? '/documents' : `/documents/folder/${fallbackFolderId}`;
      }

      setActiveViewerId(documentId);
      return doc;
    },
    [
      documentsManager,
      setActiveViewerId,
    ],
  );

  const openDocumentViewer = useCallback(
    (documentId: DocumentId, { replace = false }: { replace?: boolean } = {}) => {
      if (!documentId) return;
      detailPanelControlRef.current?.close?.();
      viewerReturnPathRef.current = `${locationPathname}${locationSearch}`;
      navigate(`/documents/${documentId}`, { replace });
    },
    [navigate, locationPathname, locationSearch, detailPanelControlRef],
  );

  const closeDocumentViewer = useCallback(
    (folderId?: FolderId) => {
      const fallbackPath = viewerReturnPathRef.current;
      viewerReturnPathRef.current = null;

      if (fallbackPath) {
        navigate(fallbackPath, { replace: false });
        return;
      }

      const targetId = folderId || selectedFolder || 'root';
      const path = targetId === 'root' ? '/documents' : `/documents/folder/${targetId}`;
      navigate(path, { replace: false });
    },
    [navigate, selectedFolder],
  );

  useEffect(() => {
    if (!routeDocumentId) {
      return undefined;
    }

    let cancelled = false;

    ensureViewerData(routeDocumentId).catch((error) => {
      if (cancelled) {
        return;
      }
      notifyApiError(error, 'Failed to open document preview.');
      closeDocumentViewer();
    });

    return () => {
      cancelled = true;
    };
  }, [routeDocumentId, ensureViewerData, notifyApiError, closeDocumentViewer]);

  const getViewerDocument = useCallback(
    () => routeDocumentId ? documentsManager.getById(routeDocumentId) : null,
    [routeDocumentId, documentsManager],
  );

  const subscribeToManager = useCallback(
    (cb: () => void) => documentsManager.subscribe(cb),
    [documentsManager],
  );

  const viewerWorkspaceDocument = useSyncExternalStore(
    subscribeToManager,
    getViewerDocument,
    getViewerDocument,
  );

  const viewerActive = Boolean(routeDocumentId && viewerWorkspaceDocument);

  return {
    ensureViewerData,
    openDocumentViewer,
    closeDocumentViewer,
    resetViewerState,
    viewerWorkspaceDocument,
    viewerActive,
  };
};

export default useDocumentViewer;
