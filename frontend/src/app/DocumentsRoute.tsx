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

  const { surface } = useWorkspaceSurface({
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

  const renderSurface = () => {
    const detailMode = surface?.detailMode ?? null;
    const layoutClass = `documents-main${sidebarHidden ? ' documents-main--sidebar-hidden' : ''}${detailMode === 'overlay' ? ' documents-main--overlay-detail' : ''}`;
    const sidebarNode = !sidebarHidden ? <Sidebar /> : null;
    const surfaceDetail = surface && (surface as { detail?: ReactNode }).detail ? (surface as { detail?: ReactNode }).detail : null;
    const surfaceBody = surface ? surface.content : null;

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

  return (
    <DocumentsFilterProvider value={documentsFilter}>
      <FullscreenPreviewProvider
        onNavigate={handleDocumentNavigate}
      >
        <DocumentsInner
          surfaceConfig={surfaceConfig}
          onNavigate={handleDocumentNavigate}
        />
      </FullscreenPreviewProvider>
    </DocumentsFilterProvider>
  );
};

const DocumentsRoute: React.FC = () => {
  const { surfaceConfig } = useDocumentsShell();
  const { detailPanelOpen, closeDetailPanel } = surfaceConfig;

  return (
    <SidebarProvider>
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
