import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { SidebarExpandIcon } from '../components/icons';
import DocumentsPanel from '../documents/panel/DocumentsPanel';
import DocumentViewerPanel from '../viewer/DocumentViewerPanel';
import { usePanelManager } from './PanelManagerContext';
import { FolderManagerProvider } from '../folders/FolderManagerContext';
import type { Identifier } from '../types/identifiers';

type EnsureAssetUrl = (
  docId: Identifier,
  asset: unknown,
  options?: Record<string, unknown>,
) => Promise<unknown> | void;
type EnsureViewerData = (docId: Identifier, options?: Record<string, unknown>) => Promise<unknown>;
type GetDocumentAsset = (document: unknown, assetType: string) => unknown;
type NotifyApiError = (error: unknown, fallbackMessage?: string) => void;

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
  viewMode?: string;
  detailPanelProps?: DetailPanelProps;
  detailPanelOpen?: boolean;
  viewerWorkspaceDocument?: unknown;
  viewerDocumentId?: Identifier | null;
  ensureAssetUrl?: EnsureAssetUrl;
  ensureViewerData?: EnsureViewerData;
  getDocumentAsset?: GetDocumentAsset;
  notifyApiError?: NotifyApiError;
  closeDocumentViewer?: () => void;
}

interface UseWorkspaceSurfaceResult {
  surface: WorkspaceSurface;
}

export const useWorkspaceSurface = ({
  sidebarHidden = false,
  onExpandSidebar,
  viewMode,
  detailPanelProps,
  detailPanelOpen = false,
  viewerWorkspaceDocument,
  viewerDocumentId,
  ensureAssetUrl,
  ensureViewerData,
  getDocumentAsset,
  notifyApiError,
  closeDocumentViewer,
}: UseWorkspaceSurfaceArgs): UseWorkspaceSurfaceResult => {
  const { registerDetailCloseHandler, setDetailActive } = usePanelManager();

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
          tags: tagOptions,
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
            tagOptions={tagOptions}
            {...restDetailProps}
          />
        );
        if (folderNodes && ensureFolderData) {
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

    return {
      content: (
        <DocumentsPanel
          headerLeading={sidebarToggle}
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
  ]);

  const showViewerWorkspace = Boolean(viewerDocumentId);

  const viewerSurface = useMemo<WorkspaceSurface>(() => {
    if (!showViewerWorkspace) {
      return null;
    }

    const sidebarToggle = renderSidebarToggle ? renderSidebarToggle() : null;
    const detailExtras = detailPanelProps || {};
    const {
      tagLookupById,
      tags: tagOptions,
      onTagAdd,
      onTagRemove,
      correspondents,
      correspondentLookupById,
      onCorrespondentAdd,
      onCorrespondentRemove,
      onUpdateTitle,
      onUpdateIssued,
      resolveFolderPath,
      folderNodes,
      ensureFolderData,
    } = detailExtras;

    const viewer = (
      <DocumentViewerPanel
        document={viewerWorkspaceDocument || null}
        hydrateDocument={ensureViewerData}
        tagLookupById={tagLookupById}
        tagOptions={tagOptions}
        onTagAdd={onTagAdd}
        onTagRemove={onTagRemove}
        correspondents={correspondents}
        correspondentLookupById={correspondentLookupById}
        onCorrespondentAdd={onCorrespondentAdd}
        onCorrespondentRemove={onCorrespondentRemove}
        onUpdateTitle={onUpdateTitle}
        onUpdateIssued={onUpdateIssued}
        ensureAssetUrl={ensureAssetUrl}
        getDocumentAsset={getDocumentAsset}
        ensurePreviewData={ensureViewerData}
        notifyApiError={notifyApiError}
        sidebarToggle={sidebarToggle}
        onClose={closeDocumentViewer}
        resolveFolderPath={resolveFolderPath}
      />
    );

    const content = folderNodes && ensureFolderData
      ? (
        <FolderManagerProvider folderNodes={folderNodes} ensureFolderData={ensureFolderData}>
          {viewer}
        </FolderManagerProvider>
      )
      : viewer;

    return { content, detail: null, detailMode: null };
  }, [
    showViewerWorkspace,
    viewerWorkspaceDocument,
    ensureViewerData,
    ensureAssetUrl,
    getDocumentAsset,
    notifyApiError,
    renderSidebarToggle,
    closeDocumentViewer,
    detailPanelProps,
  ]);

  const surface = useMemo<WorkspaceSurface>(() => {
    if (showViewerWorkspace) {
      return viewerSurface;
    }
    return documentsSurface;
  }, [showViewerWorkspace, viewerSurface, documentsSurface]);

  return { surface };
};
