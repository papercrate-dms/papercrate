import { useMemo } from 'react';
import { useFolderTree } from '../lib/context/FolderTreeContext';
import { useDocumentsSearch } from '../lib/context/DocumentsSearchContext';
import { useDocumentsWorkspaceContext } from '../lib/context/DocumentsWorkspaceContext';
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
  const { foldersManager, handleBreadcrumbNavigate } = useFolderTree();
  const { documentsViewMode, documentsFilter, documentsManager } = useDocumentsSearch();
  const workspace = useDocumentsWorkspaceContext();

  return useMemo(() => {
    const surfaceConfig: WorkspaceSurfaceConfig = {
      viewMode: documentsViewMode,
      detailPanelProps: (workspace.detailPanelProps ?? null) as WorkspaceSurfaceConfig['detailPanelProps'],
      detailPanelOpen: Boolean(workspace.detailPanelOpen),
      openDetailPanel: workspace.openDetailPanel as WorkspaceSurfaceConfig['openDetailPanel'],
      closeDetailPanel: workspace.closeDetailPanel as WorkspaceSurfaceConfig['closeDetailPanel'],
      viewerDocumentId: (workspace.viewerDocumentId as Identifier) ?? null,
      closeDocumentViewer: workspace.closeDocumentViewer as WorkspaceSurfaceConfig['closeDocumentViewer'],
      viewerReturnPath: workspace.viewerReturnPath ?? null,
      handleBreadcrumbNavigate: handleBreadcrumbNavigate as WorkspaceSurfaceConfig['handleBreadcrumbNavigate'],
    };

    return {
      surfaceConfig,
      documentsFilter: documentsFilter as DocumentsFilterValue,
      documentsManager,
      foldersManager,
    };
  }, [documentsViewMode, documentsFilter, documentsManager, workspace, handleBreadcrumbNavigate, foldersManager]);
};

export default useDocumentsShell;
