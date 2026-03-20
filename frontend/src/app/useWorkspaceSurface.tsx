import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { SidebarExpandIcon } from '../components/icons';
import DocumentsPanel from '../documents/panel/DocumentsPanel';
import DocumentViewerPanel from '../viewer/DocumentViewerPanel';
import SelectionActionsTrash from '../documents/features/selection/SelectionActionsTrash';
import { usePanelManager } from './PanelManagerContext';
import { FolderManagerProvider } from '../folders/FolderManagerContext';
import { useFolderTree } from '../lib/context/FolderTreeContext';
import { useDocumentsWorkspaceContext } from '../lib/context/DocumentsWorkspaceContext';
import { useDocumentsSearch } from '../lib/context/DocumentsSearchContext';
import type { Identifier } from '../types/identifiers';

type DetailPanelProps = (ComponentProps<typeof DocumentViewerPanel> & {
  onClose?: () => void;
  onOpenViewer?: (args: { documentIds: Array<string> }) => void;
  folderNodes?: Map<Identifier | 'root', unknown>;
  ensureFolderData?: (
    folderId: Identifier | 'root',
    options?: { force?: boolean; includeDocuments?: boolean },
  ) => Promise<void>;
}) | null;

type WorkspaceSurface = { content: ReactNode; detail?: ReactNode | null; detailMode?: 'overlay' | 'inline' | null } | null;

export interface UseWorkspaceSurfaceArgs {
  sidebarHidden?: boolean;
  onExpandSidebar?: () => void;
}

interface UseWorkspaceSurfaceResult {
  documentsSurface: WorkspaceSurface;
  viewerSurface: WorkspaceSurface;
}

export const useWorkspaceSurface = ({
  sidebarHidden = false,
  onExpandSidebar,
}: UseWorkspaceSurfaceArgs): UseWorkspaceSurfaceResult => {
  const { registerDetailCloseHandler, setDetailActive } = usePanelManager();
  const { selectedFolder } = useFolderTree();
  const workspace = useDocumentsWorkspaceContext();
  const { documentsViewMode: viewMode } = useDocumentsSearch();

  const detailPanelProps = (workspace.detailPanelProps ?? null) as DetailPanelProps;
  const detailPanelOpen = Boolean(workspace.detailPanelOpen);
  const viewerDocumentId = workspace.viewerDocumentId ?? null;
  const closeDocumentViewer = workspace.closeDocumentViewer;

  useEffect(() => {
    const handler = detailPanelProps?.onClose || null;
    registerDetailCloseHandler(handler);
    return () => registerDetailCloseHandler(null);
  }, [registerDetailCloseHandler, detailPanelProps?.onClose]);

  const setDetailActiveRef = useRef(setDetailActive);
  useEffect(() => {
    setDetailActiveRef.current = setDetailActive;
  }, [setDetailActive]);

  useEffect(() => {
    setDetailActive(Boolean(detailPanelOpen));
  }, [detailPanelOpen, setDetailActive]);

  useEffect(() => {
    return () => {
      if (setDetailActiveRef.current) {
        setDetailActiveRef.current(false);
      }
    };
  }, []);

  const renderSidebarToggle = useCallback<() => ReactNode>(() => {
    if (!sidebarHidden) {
      return null;
    }
    return (
      <button
        type="button"
        className="icon-button"
        onClick={onExpandSidebar}
        aria-label="Expand sidebar"
        title="Expand sidebar"
      >
        <SidebarExpandIcon />
      </button>
    );
  }, [sidebarHidden, onExpandSidebar]);

  const documentsSurface = useMemo<WorkspaceSurface>(() => {
    const sidebarToggle = renderSidebarToggle ? renderSidebarToggle() : null;
    const sidebarMode = viewMode === 'desk' ? 'overlay' : 'inline';

    const detailMode: 'overlay' | 'inline' | null = detailPanelOpen && detailPanelProps ? sidebarMode : null;
    const detail = detailPanelOpen && detailPanelProps
      ? (() => {
        const {
          onClose,
          onOpenViewer,
          folderNodes,
          ensureFolderData,
          ...restDetailProps
        } = detailPanelProps;
        const viewer = (
          <DocumentViewerPanel
            variant="sidebar"
            sidebarMode={sidebarMode}
            onClose={onClose}
            onMaximize={onOpenViewer}
            {...restDetailProps}
          />
        );
        if (folderNodes) {
          return (
            <FolderManagerProvider folderNodes={folderNodes} ensureFolderData={ensureFolderData}>
              {viewer}
            </FolderManagerProvider>
          );
        }
        return (
          <>{viewer}</>
        );
      })()
      : null;

    const trashProps = selectedFolder === 'trash' ? {
      selectionActions: <SelectionActionsTrash />,
      emptyMessage: 'Trash is empty.',
    } : {};

    return {
      content: (
        <DocumentsPanel
          headerLeading={sidebarToggle}
          {...trashProps}
        />
      ),
      detail,
      detailMode,
    };
  }, [
    viewMode,
    renderSidebarToggle,
    detailPanelOpen,
    detailPanelProps,
    selectedFolder,
  ]);

  const showViewerWorkspace = Boolean(viewerDocumentId);

  const viewerSurface = useMemo<WorkspaceSurface>(() => {
    if (!showViewerWorkspace) {
      return null;
    }

    const sidebarToggle = renderSidebarToggle ? renderSidebarToggle() : null;
    const detailExtras = detailPanelProps || {};
    const {
      resolveFolderPath,
      folderNodes,
      ensureFolderData,
    } = detailExtras;

    const viewer = (
      <DocumentViewerPanel
        documentId={viewerDocumentId || null}
        sidebarToggle={sidebarToggle}
        onClose={closeDocumentViewer}
        resolveFolderPath={resolveFolderPath}
      />
    );

    const content = folderNodes
      ? (
        <FolderManagerProvider folderNodes={folderNodes} ensureFolderData={ensureFolderData}>
          {viewer}
        </FolderManagerProvider>
      )
      : viewer;

    return { content, detail: null, detailMode: null };
  }, [
    showViewerWorkspace,
    viewerDocumentId,
    renderSidebarToggle,
    closeDocumentViewer,
    detailPanelProps,
  ]);

  return { documentsSurface, viewerSurface };
};
