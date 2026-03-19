import React, { useCallback, useEffect } from 'react';
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

const DocumentsInner: React.FC<{
  surfaceConfig: any;
  onNavigate: (documentId: string) => void;
}> = ({ surfaceConfig, onNavigate }) => {
  const { openFullscreenPreview } = useFullscreenPreviewContext();
  const { collapsed: sidebarCollapsed } = useSidebarContext();
  const {
    sidebarSuppressed,
    expandSidebar,
  } = usePanelManager();

  const { openDetailPanel } = surfaceConfig;
  const sidebarHidden = sidebarCollapsed || sidebarSuppressed;
  const { top: activePanel, push, remove } = useMainPanelStack();

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

  // Sync viewer route with stack
  const viewerDocId = surfaceConfig.viewerDocumentId ?? null;
  useEffect(() => {
    if (viewerDocId != null) {
      push('viewer');
    } else {
      remove('viewer');
    }
  }, [viewerDocId, push, remove]);

  const renderSurface = () => {
    const surface = activePanel === 'viewer'
      ? (viewerSurface ?? documentsSurface)
      : documentsSurface;

    const detailMode = surface?.detailMode ?? null;
    const layoutClass = cx('documents-main', sidebarHidden && 'documents-main--sidebar-hidden', detailMode === 'overlay' && 'documents-main--overlay-detail');
    const sidebarNode = !sidebarHidden ? <Sidebar /> : null;
    const surfaceDetail = surface && (surface as { detail?: ReactNode }).detail ? (surface as { detail?: ReactNode }).detail : null;
    const surfaceBody = surface?.content ?? null;

    return (
      <main className={layoutClass}>
        {sidebarNode}
        <div className="main-content">
          {surfaceBody}
        </div>
        {surfaceDetail}
      </main>
    );
  };

  return (
    <DocumentOpenProvider
      onOpenViewer={onNavigate}
      onOpenFullscreenPreview={openFullscreenPreview}
      onOpenDetailPanel={openDetailPanel}
    >
      {renderSurface()}
    </DocumentOpenProvider>
  );
};

const DocumentsRouteContent: React.FC = () => {
  const {
    surfaceConfig,
    documentsFilter,
  } = useDocumentsShell();
  const navigate = useNavigate();

  const handleDocumentNavigate = useCallback((documentId: string) => {
    navigate(`/documents/${documentId}`);
  }, [navigate]);

  const initialStack: MainPanel[] = ['documents'];
  if (surfaceConfig.viewerDocumentId) initialStack.push('viewer');

  return (
    <DocumentsFilterProvider value={documentsFilter}>
      <MainPanelStackProvider initialStack={initialStack}>
        <SearchPanelProvider>
          <FullscreenPreviewProvider
            onNavigate={handleDocumentNavigate}
          >
            <DocumentsInner
              surfaceConfig={surfaceConfig}
              onNavigate={handleDocumentNavigate}
            />
          </FullscreenPreviewProvider>
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
