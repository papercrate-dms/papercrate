import { useMemo } from 'react';
import { useAppShell } from '../lib/context/AppShellContext';
import type { DocumentsFilterValue } from '../documents/context/DocumentsFilterContext';
import type { UseWorkspaceSurfaceArgs } from './useWorkspaceSurface';
import type { Identifier } from '../types/identifiers';

type WorkspaceSurfaceConfig = Omit<UseWorkspaceSurfaceArgs, 'sidebarHidden' | 'onExpandSidebar'> & {
  openDetailPanel?: (documentId: Identifier) => void;
  closeDetailPanel?: () => void;
  handleBreadcrumbNavigate?: (crumb: any) => void;
};

interface DocumentsShellView {
  surfaceConfig: WorkspaceSurfaceConfig;
  documentsFilter: DocumentsFilterValue;
  documentsManager: any;
  foldersManager: any;
}

const useDocumentsShell = (): DocumentsShellView => {
  const shell = useAppShell() as any;

  return useMemo(() => {
    const surfaceConfig: WorkspaceSurfaceConfig = {
      viewMode: shell.search?.documentsViewMode,
      detailPanelProps: (shell.detailPanel?.detailPanelProps ?? null) as WorkspaceSurfaceConfig['detailPanelProps'],
      detailPanelOpen: Boolean(shell.detailPanel?.detailPanelOpen),
      openDetailPanel: shell.detailPanel?.openDetailPanel as WorkspaceSurfaceConfig['openDetailPanel'],
      closeDetailPanel: shell.detailPanel?.closeDetailPanel as WorkspaceSurfaceConfig['closeDetailPanel'],
      viewerWorkspaceDocument: shell.preview?.viewerWorkspaceDocument,
      viewerDocumentId: (shell.preview?.viewerDocumentId as Identifier) ?? null,
      closeDocumentViewer: shell.preview?.closeDocumentViewer as WorkspaceSurfaceConfig['closeDocumentViewer'],
      ensureViewerData: shell.preview?.ensureViewerData as WorkspaceSurfaceConfig['ensureViewerData'],
      ensureAssetUrl: shell.preview?.ensureAssetUrl as WorkspaceSurfaceConfig['ensureAssetUrl'],
      getDocumentAsset: shell.preview?.getDocumentAsset as WorkspaceSurfaceConfig['getDocumentAsset'],
      notifyApiError: shell.ui?.notifyApiError as WorkspaceSurfaceConfig['notifyApiError'],
      handleBreadcrumbNavigate: shell.folderTree?.handleBreadcrumbNavigate as WorkspaceSurfaceConfig['handleBreadcrumbNavigate'],
    };

    return {
      surfaceConfig,
      documentsFilter: shell.search?.documentsFilter as DocumentsFilterValue,
      documentsManager: shell.managers?.documentsManager,
      foldersManager: shell.folderTree?.foldersManager,
    };
  }, [shell]);
};

export default useDocumentsShell;
