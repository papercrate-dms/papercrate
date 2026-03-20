import '@fontsource/inter/400.css';

import React from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom';
import './styles/index.css';
import DocumentsRoute from './app/DocumentsRoute';
import DropOverlay from './app/DropOverlay';
import LoginRoute from './app/LoginRoute';
import SettingsRoute from './app/SettingsRoute';
import { AppStateProvider, useAppState } from './lib/store/appState';
import { useDocumentsPreferences } from './app/useDocumentsPreferences';
import useDocumentsWorkspace from './documents/data/useDocumentsWorkspace';
import UploadQueueOverlay from './app/UploadQueueOverlay';
import { StatusToastProvider } from './lib/context/StatusToastContext';
import StatusToastOverlay from './components/StatusToastOverlay';
import { SessionProvider } from './lib/context/SessionContext';
import { FolderProvider } from './lib/context/FolderContext';
import { DocumentsSearchProvider } from './lib/context/DocumentsSearchContext';
import { TagsProvider } from './lib/context/TagsContext';
import { CorrespondentsProvider } from './lib/context/CorrespondentsContext';
import { UIProvider } from './lib/context/UIContext';
import { FolderTreeProvider } from './lib/context/FolderTreeContext';
import { DocumentsWorkspaceProvider } from './lib/context/DocumentsWorkspaceContext';
import { NewDocumentsProvider } from './lib/context/NewDocumentsContext';
import { useUI } from './lib/context/UIContext';
import { useDocumentsWorkspaceContext } from './lib/context/DocumentsWorkspaceContext';

// Rendered inside the provider tree so they can read from context
const ManagementModalsOverlay: React.FC = () => {
  const { managementModals } = useUI();
  return <>{managementModals}</>;
};

const SettingsOverlay: React.FC = () => {
  const { settingsOpen, closeSettings } = useUI();
  if (!settingsOpen) return null;
  return <SettingsRoute open onClose={closeSettings} />;
};

const UploadOverlays: React.FC = () => {
  const { uploadQueue, clearUploadQueue, dropOverlayState } = useUI();
  const { openDocumentViewerForDetail } = useDocumentsWorkspaceContext();
  return (
    <>
      <DropOverlay
        active={dropOverlayState.active}
        folderName={dropOverlayState.folderName}
      />
      <UploadQueueOverlay
        queue={uploadQueue || []}
        onClearQueue={clearUploadQueue}
        onDocumentClick={(documentId) => openDocumentViewerForDetail({ documentIds: [documentId] })}
      />
    </>
  );
};

// Nesting order: Session > Folder > Search > Tags > Correspondents > UI > FolderTree > Workspace
// - Folder above Search so SearchProvider reads selectedFolder/visibleSubfolders from FolderContext.
// - Search above Tags/Correspondents so they read filter state from SearchContext.
// - Folder above UI so UIProvider reads selectedFolder/refreshCurrentFolder from FolderContext.
// - UI above FolderTree so FolderTreeProvider reads handleFileDrop from UIContext.
const AppLayout: React.FC = () => {
  const prefs = useDocumentsPreferences();
  const ws = useDocumentsWorkspace({
    documentsViewMode: prefs.documentsViewMode,
    documentsSortField: prefs.documentsSortField,
    documentsSortDirection: prefs.documentsSortDirection,
    onDocumentsViewModeChange: prefs.handleDocumentsViewModeChange,
    onDocumentsSortFieldChange: prefs.handleDocumentsSortFieldChange,
    onDocumentsSortDirectionToggle: prefs.handleDocumentsSortDirectionToggle,
    searchIncludeDescendants: prefs.searchIncludeDescendants,
    onSetSearchIncludeDescendants: prefs.setSearchIncludeDescendants,
  });

  if (['logged-out', 'authenticating', 'selecting-tenant'].includes(ws.appStatus)) {
    const redirectTarget = `${ws.location.pathname}${ws.location.search}${ws.location.hash || ''}`;
    return <Navigate to="/account/login" replace state={{ from: redirectTarget }} />;
  }

  return (
    <SessionProvider onDocumentsViewModeChange={ws.onDocumentsViewModeChange}>
      <FolderProvider {...ws.folderProps}>
        <DocumentsSearchProvider {...ws.searchProps}>
          <TagsProvider {...ws.tagsProps}>
            <CorrespondentsProvider {...ws.correspondentsProps}>
              <UIProvider shellRef={ws.shellRef}>
                <FolderTreeProvider {...ws.folderTreeProps}>
                  <DocumentsWorkspaceProvider {...ws.workspaceProps}>
                    <NewDocumentsProvider>
                      <div className="app-shell" ref={ws.shellRef}>
                        <UploadOverlays />
                        <StatusToastOverlay />
                        <Outlet />
                        <ManagementModalsOverlay />
                        <SettingsOverlay />
                      </div>
                    </NewDocumentsProvider>
                  </DocumentsWorkspaceProvider>
                </FolderTreeProvider>
              </UIProvider>
            </CorrespondentsProvider>
          </TagsProvider>
        </DocumentsSearchProvider>
      </FolderProvider>
    </SessionProvider>
  );
};

const TenantAwareLayout: React.FC = () => {
  const { tenant } = useAppState();
  const key = tenant?.id ? String(tenant.id) : undefined;
  return <AppLayout key={key} />;
};

const AppRouter: React.FC = () => (
  <Routes>
    <Route path="/account/login" element={<LoginRoute />} />
    <Route element={<TenantAwareLayout />}>
      <Route path="/" element={<Navigate to="/folders" replace />} />
      <Route element={<DocumentsRoute />}>
        <Route path="/folders" element={null} />
        <Route path="/folders/:folderId" element={null} />
        <Route path="/trash" element={null} />
        <Route path="/documents/:documentId" element={null} />
      </Route>
      <Route path="*" element={<Navigate to="/folders" replace />} />
    </Route>
  </Routes>
);

const container = document.getElementById('app');
if (!container) throw new Error('App root element #app not found');

const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <AppStateProvider>
      <StatusToastProvider>
        <HashRouter>
          <AppRouter />
        </HashRouter>
      </StatusToastProvider>
    </AppStateProvider>
  </ErrorBoundary>,
);
