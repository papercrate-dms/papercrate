import { useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { resolveDocumentAssetUrl } from '../../lib/assets/AssetManager';
import { useDetailPanel } from '../../app/useDetailPanel';
import type { DocumentInfoPanelProps } from '../components/DocumentInfoPanel';
import type { EnsureAssetUrl, GetAsset } from '../../lib/assets/AssetManager';
import type { Identifier } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import type { Tag, Correspondent } from '../../types/documents';
import { listFolderContents } from '../../lib/api/apiClient';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import useNotifyApiError from '../../hooks/useNotifyApiError';

interface FolderNode {
  id: Identifier | 'root';
  name?: string;
  parentId?: Identifier | 'root';
}

interface UseDetailWorkspaceArgs {
  documentLookup: Map<Identifier, Document>;
  folderNodes: Map<Identifier | 'root', FolderNode>;
  detailPanelControlRef: MutableRefObject<{ open?: (documentId: Identifier) => void; close?: () => void } | null>;
  detailFolderFetchRef: MutableRefObject<Set<Identifier | 'root'>>;
  openDocumentViewer?: (args: { documentIds: Identifier[] }) => void;
  handleDocumentTitleUpdate?: (docId: Identifier, title: string) => Promise<boolean> | boolean;
  handleDocumentIssuedUpdate?: (docId: Identifier, issued: number | null) => Promise<boolean> | boolean;
  handleDocumentTagAdd?: (doc: Document, value: string, context?: { option?: unknown }) => void;
  handleDocumentTagDetach?: (...args: unknown[]) => void;
  ensureAssetUrl?: EnsureAssetUrl;
  getAsset?: GetAsset;
  correspondents?: unknown[];
  handleCorrespondentAdd?: (...args: unknown[]) => void;
  handleCorrespondentRemove?: (...args: unknown[]) => void;
  selectFolder?: (folderId?: Identifier | 'root') => void;
  tags?: unknown[];
  tagLookupById?: Map<Identifier, Tag> | null;
  correspondentLookupById?: Map<Identifier, Correspondent> | null;
  resolveFolderPath?: (folderId?: Identifier | 'root') => Array<{ id: Identifier | 'root'; name: string }>;
}

interface UseDetailWorkspaceResult {
  detailPanelProps: DocumentInfoPanelProps;
  detailPanelOpen: boolean;
  openDetailPanel: ReturnType<typeof useDetailPanel>['openDetailPanel'];
  closeDetailPanel: ReturnType<typeof useDetailPanel>['closeDetailPanel'];
  handleDetailPanelClose: () => void;
  resolveThumbnailUrlForDoc: (doc: Document | null) => string | null;
  resolveFolderPath: (folderId?: Identifier | 'root') => Array<{ id: Identifier | 'root'; name: string }>;
}

const useDetailWorkspace = ({
  documentLookup,
  folderNodes,
  detailPanelControlRef,
  detailFolderFetchRef,
  openDocumentViewer,
  handleDocumentTitleUpdate,
  handleDocumentIssuedUpdate,
  handleDocumentTagAdd,
  handleDocumentTagDetach,
  ensureAssetUrl,
  getAsset,
  correspondents,
  handleCorrespondentAdd,
  handleCorrespondentRemove,
  selectFolder,
  tags,
  tagLookupById,
  correspondentLookupById,
  resolveFolderPath,
}: UseDetailWorkspaceArgs): UseDetailWorkspaceResult => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const {
    detailPanelOpen,
    detailPanelDocument,
    openDetailPanel,
    closeDetailPanel,
  } = useDetailPanel({
    documentLookup,
  });

  useEffect(() => {
    detailPanelControlRef.current = {
      open: openDetailPanel,
      close: closeDetailPanel,
    };
  }, [detailPanelControlRef, openDetailPanel, closeDetailPanel]);

  // Prefetch folder ancestors for breadcrumb display
  useEffect(() => {
    const folderId = detailPanelDocument?.folder_id;
    if (!folderId) {
      return;
    }

    const visited = new Set();
    let currentId = folderId;
    let guard = 0;

    while (currentId && currentId !== 'root' && guard < 32) {
      guard += 1;
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);

      const node = folderNodes.get(currentId);
      if (!node) {
        if (!detailFolderFetchRef.current.has(currentId)) {
          detailFolderFetchRef.current.add(currentId);
          listFolderContents(currentId, { include_documents: false })
            .catch((error) => {
              console.warn('Failed to preload folder metadata for detail path', currentId, error);
            })
            .finally(() => {
              detailFolderFetchRef.current.delete(currentId);
            });
        }
        break;
      }

      const parentId = node.parentId ?? 'root';
      if (!parentId || parentId === 'root') {
        break;
      }
      currentId = parentId;
    }
  }, [detailPanelDocument, folderNodes, detailFolderFetchRef]);

  const resolveThumbnailUrlForDoc = useCallback(
    (doc) =>
      resolveDocumentAssetUrl(doc, 'thumbnail', {
        ensureAssetUrl,
        getAsset,
      }),
    [ensureAssetUrl, getAsset],
  );

  const handleDetailPanelClose = useCallback(() => {
    closeDetailPanel();
  }, [closeDetailPanel]);

  const handleDetailTagAdd = useCallback(
    async (doc: Document, value: string, context?: { option?: unknown }) => {
      if (!handleDocumentTagAdd) return;
      try {
        await handleDocumentTagAdd(doc, value, context);
        showToast('Tag assigned.', 'success');
      } catch (error) {
        notifyApiError(error, 'Failed to assign tag.');
      }
    },
    [handleDocumentTagAdd, showToast, notifyApiError],
  );

  const handleDetailTagRemove = useCallback(
    async (docId: any, tagId: any) => {
      if (!handleDocumentTagDetach) return;
      try {
        await handleDocumentTagDetach(docId, tagId);
        showToast('Tag removed.', 'success');
      } catch (error) {
        notifyApiError(error, 'Failed to remove tag.');
      }
    },
    [handleDocumentTagDetach, showToast, notifyApiError],
  );

  const detailPanelProps = {
    document: detailPanelDocument,
    tags,
    tagLookupById,
    correspondentLookupById,
    onTagAdd: handleDetailTagAdd,
    onTagRemove: handleDetailTagRemove,
    onOpenViewer: openDocumentViewer,
    onUpdateTitle: handleDocumentTitleUpdate,
    onUpdateIssued: handleDocumentIssuedUpdate,
    ensureAssetUrl,
    getDocumentAsset: getAsset,
    correspondents,
    onCorrespondentAdd: handleCorrespondentAdd,
    onCorrespondentRemove: handleCorrespondentRemove,
    onFolderNavigate: selectFolder,
    onClose: handleDetailPanelClose,
    resolveFolderPath,
    folderNodes,
  };

  return {
    detailPanelProps,
    detailPanelOpen,
    openDetailPanel,
    closeDetailPanel,
    handleDetailPanelClose,
    resolveThumbnailUrlForDoc,
    resolveFolderPath,
  };
};

export default useDetailWorkspace;
