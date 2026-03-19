import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DocumentsFilterProvider,
} from '../documents/context/DocumentsFilterContext';
import { FullscreenPreviewProvider, useFullscreenPreviewContext } from '../viewer/FullscreenPreviewContext';
import { DocumentOpenProvider } from '../lib/context/DocumentOpenContext';
import { useWorkspaceSurface } from './useWorkspaceSurface';
import { SidebarProvider, useSidebarContext } from '../sidebar/SidebarContext';
import { PanelManagerProvider, usePanelManager } from './PanelManagerContext';
import { PANEL_LIMITS } from '../constants/layout';
import { SearchPanelProvider } from '../documents/context/SearchPanelContext';
import { MainPanelStackProvider, useMainPanelStack } from './MainPanelStackContext';
import type { MainPanel } from './MainPanelStackContext';
import { cx } from '../utils/cx';
import Sidebar from '../sidebar/Sidebar';
import useDocumentsShell from './useDocumentsShell';
import { useDocumentsWorkspaceContext } from '../lib/context/DocumentsWorkspaceContext';
import { useFolderTree } from '../lib/context/FolderTreeContext';

/**
 * Renders the actual layout (sidebar + main content + detail panel).
 * Lives below FullscreenPreviewProvider so it can consume the preview context.
 */
const DocumentsContent: React.FC<{
  surfaceConfig: any;
  onOpenViewer: (documentId: string) => void;
}> = ({ surfaceConfig, onOpenViewer }) => {
  const { openFullscreenPreview } = useFullscreenPreviewContext();
  const { collapsed: sidebarCollapsed } = useSidebarContext();
  const {
    sidebarSuppressed,
    expandSidebar,
  } = usePanelManager();

  const { openDetailPanel } = surfaceConfig;
  const sidebarHidden = sidebarCollapsed || sidebarSuppressed;
  const { top: activePanel } = useMainPanelStack();

  const { documentsSurface, viewerSurface } = useWorkspaceSurface({
    sidebarHidden,
    onExpandSidebar: expandSidebar,
    ...surfaceConfig,
  });

  useEffect(() => {
    document.body.classList.add('has-main-content');
    return () => {
      document.body.classList.remove('has-main-content');
    };
  }, []);

  const surface = activePanel === 'viewer'
    ? (viewerSurface ?? documentsSurface)
    : documentsSurface;

  const detailMode = surface?.detailMode ?? null;
  const layoutClass = cx(
    'documents-main',
    sidebarHidden && 'documents-main--sidebar-hidden',
    detailMode === 'overlay' && 'documents-main--overlay-detail',
  );
  const sidebarNode = !sidebarHidden ? <Sidebar /> : null;
  const surfaceDetail = (surface as { detail?: ReactNode } | null)?.detail ?? null;
  const surfaceBody = surface?.content ?? null;

  return (
    <DocumentOpenProvider
      onOpenViewer={onOpenViewer}
      onOpenFullscreenPreview={openFullscreenPreview}
      onOpenDetailPanel={openDetailPanel}
    >
      <main className={layoutClass}>
        {sidebarNode}
        <div className="main-content">
          {surfaceBody}
        </div>
        {surfaceDetail}
      </main>
    </DocumentOpenProvider>
  );
};

/**
 * Reactive bridge between viewer state (source of truth), the panel stack,
 * and the URL.
 *
 * - viewerDocumentId state changes  →  stack pushes/pops  +  URL updates
 * - open/close handlers only manipulate state; this layer handles the rest
 *
 * Also syncs folder selection state to the URL.
 *
 * Lives inside MainPanelStackProvider so it has access to the stack.
 */
const DocumentsInner: React.FC<{
  surfaceConfig: any;
}> = ({ surfaceConfig }) => {
  const navigate = useNavigate();
  const { push, remove } = useMainPanelStack();
  const workspace = useDocumentsWorkspaceContext();
  const folderTree = useFolderTree();

  const viewerDocId = surfaceConfig.viewerDocumentId ?? null;
  const viewerReturnPath = surfaceConfig.viewerReturnPath;
  const selectedFolder = folderTree.selectedFolder;

  // --- Reactive bridge: state → stack ---
  useEffect(() => {
    if (viewerDocId != null) {
      push('viewer');
    } else {
      remove('viewer');
    }
  }, [viewerDocId, push, remove]);

  // --- Reactive bridge: state → URL (viewer) ---
  // Only fires when viewerDocId changes. Both navigate and viewerReturnPath
  // are read via refs so that (a) React Router's unstable navigate reference
  // doesn't re-trigger the effect, and (b) sidebar folder changes don't
  // trigger spurious navigations.
  const isInitialMount = useRef(true);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const viewerReturnPathRef = useRef(viewerReturnPath);
  viewerReturnPathRef.current = viewerReturnPath;

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (viewerDocId != null) {
      navigateRef.current(`/documents/${viewerDocId}`, { replace: true });
    } else {
      const returnTo = viewerReturnPathRef.current;
      if (returnTo) {
        navigateRef.current(returnTo, { replace: true });
      }
    }
  }, [viewerDocId]);

  // --- Reactive bridge: state → URL (folder selection) ---
  // Only fires when selectedFolder changes. The navigate ref pattern prevents
  // the effect from re-triggering due to navigate function reference changes.
  // Skip initial mount to avoid redundant URL updates (route param is correct on load).
  const isFolderInitialMount = useRef(true);
  const folderNavigateRef = useRef(navigate);
  folderNavigateRef.current = navigate;

  useEffect(() => {
    if (isFolderInitialMount.current) {
      isFolderInitialMount.current = false;
      return;
    }

    if (selectedFolder === 'trash') {
      folderNavigateRef.current('/trash', { replace: true });
    } else if (selectedFolder && selectedFolder !== 'root') {
      folderNavigateRef.current(`/folders/${selectedFolder}`, { replace: true });
    } else {
      // root folder - navigate to home or a default route
      folderNavigateRef.current('/', { replace: true });
    }
  }, [selectedFolder]);

  // --- Open viewer handler ---
  // Thin adapter: DocumentOpenProvider passes (documentId: string),
  // workspace.openDocumentViewerForDetail expects ({ documentIds: [...] }).
  // After this sets state, the effects above handle stack + URL.
  const onOpenViewer = useCallback((documentId: string) => {
    workspace.openDocumentViewerForDetail({ documentIds: [documentId] });
  }, [workspace.openDocumentViewerForDetail]);

  return (
    <FullscreenPreviewProvider onNavigate={onOpenViewer}>
      <DocumentsContent
        surfaceConfig={surfaceConfig}
        onOpenViewer={onOpenViewer}
      />
    </FullscreenPreviewProvider>
  );
};

const DocumentsRouteContent: React.FC = () => {
  const {
    surfaceConfig,
    documentsFilter,
  } = useDocumentsShell();

  const initialStack: MainPanel[] = ['documents'];
  if (surfaceConfig.viewerDocumentId) initialStack.push('viewer');

  return (
    <DocumentsFilterProvider value={documentsFilter}>
      <MainPanelStackProvider initialStack={initialStack}>
        <SearchPanelProvider>
          <DocumentsInner
            surfaceConfig={surfaceConfig}
          />
        </SearchPanelProvider>
      </MainPanelStackProvider>
    </DocumentsFilterProvider>
  );
};

const DocumentsRoute: React.FC = () => {
  const { surfaceConfig } = useDocumentsShell();
  const { detailPanelOpen, closeDetailPanel } = surfaceConfig;

  return (
    <SidebarProvider forceCollapsed={window.innerWidth <= PANEL_LIMITS.sidebar.minPx * 2}>
      <PanelManagerProvider
        isOpen={detailPanelOpen}
        onClose={closeDetailPanel}
      >
        <DocumentsRouteContent />
      </PanelManagerProvider>
    </SidebarProvider>
  );
};

export default DocumentsRoute;
