import { useCallback, useEffect, useRef, useState } from 'react';
import { getAssetFromVersion } from '../../lib/assets/AssetManager';
import { mergeAssetIntoDocument } from '../../app/workspaceUtils';
import useDocumentViewer from '../../app/useDocumentViewer';
import type AssetManager from '../../lib/assets/AssetManager';
import type { DocumentId, FolderNodeId, Identifier } from '../../types/identifiers';

interface UseViewerStateOptions {
  routeDocumentId: string | null;
  selectedFolder: FolderNodeId;
  locationPathname: string;
  locationSearch: string;
  assetManager: AssetManager;
  documentsManager: { update: (id: DocumentId, updater: (doc: any) => any) => boolean };
  notifyApiError: (error: unknown, fallbackMessage?: string) => void;
}

const useViewerState = ({
  routeDocumentId,
  selectedFolder,
  locationPathname,
  locationSearch,
  assetManager,
  documentsManager,
  notifyApiError,
}: UseViewerStateOptions) => {
  // --- Detail panel ---
  const detailPanelControlRef = useRef({ open: () => { }, close: () => { } });
  const [detailPanelDocId, setDetailPanelDocId] = useState<DocumentId | null>(null);
  const detailPanelOpen = detailPanelDocId !== null;

  const openDetailPanel = useCallback(
    (documentId: Identifier) => {
      if (!documentId) return;
      setDetailPanelDocId(documentId as DocumentId);
    },
    [],
  );

  const closeDetailPanel = useCallback(() => {
    setDetailPanelDocId(null);
  }, []);

  useEffect(() => {
    detailPanelControlRef.current = {
      open: openDetailPanel,
      close: closeDetailPanel,
    };
  }, [detailPanelControlRef, openDetailPanel, closeDetailPanel]);

  // --- Viewer state ---
  const [activeViewerId, setActiveViewerId] = useState<DocumentId | null>(routeDocumentId || null);
  const [viewerDocumentId, setViewerDocumentId] = useState<DocumentId | null>(routeDocumentId || null);

  const {
    openDocumentViewer,
    closeDocumentViewer,
    resetViewerState,
    viewerReturnPath,
  } = useDocumentViewer({
    selectedFolder,
    locationPathname,
    locationSearch,
    detailPanelControlRef,
    setActiveViewerId,
    setViewerDocumentId,
  });

  const viewerActive = viewerDocumentId != null;

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

  // --- Asset helpers ---
  const getDocumentAsset = useCallback((doc, type) => {
    if (!doc || !type) return null;
    return getAssetFromVersion(doc.current_version || null, type);
  }, []);

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

  /** Reset all viewer + detail panel state (called on logout / tenant switch). */
  const resetAllViewerState = useCallback(() => {
    setActiveViewerId(null);
    setViewerDocumentId(null);
    closeDetailPanel();
    resetViewerState();
  }, [closeDetailPanel, resetViewerState]);

  return {
    // Detail panel
    detailPanelDocId,
    detailPanelOpen,
    openDetailPanel,
    closeDetailPanel,
    detailPanelControlRef,
    // Viewer
    activeViewerId,
    setActiveViewerId,
    viewerDocumentId,
    setViewerDocumentId,
    viewerActive,
    openDocumentViewer,
    openDocumentViewerForDetail,
    closeDocumentViewer,
    resetViewerState,
    resetAllViewerState,
    viewerReturnPath,
    // Assets
    getDocumentAsset,
    ensureAssetUrl,
  };
};

export default useViewerState;
