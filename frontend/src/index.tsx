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
import DomainProviderStack from './lib/context/DomainProviderStack';
import UploadQueueOverlay from './app/UploadQueueOverlay';
import { StatusToastProvider } from './lib/context/StatusToastContext';
import StatusToastOverlay from './components/StatusToastOverlay';

const AppLayout: React.FC = () => {
  const documentsPreferences = useDocumentsPreferences();
  const {
    appStatus,
    location,
    shellRef,
    dropOverlayState,
    managementModals,
    domains,
    settingsOpen,
    closeSettings,
  } = useDocumentsWorkspace({
    documentsViewMode: documentsPreferences.documentsViewMode,
    documentsSortField: documentsPreferences.documentsSortField,
    documentsSortDirection: documentsPreferences.documentsSortDirection,
    onDocumentsViewModeChange: documentsPreferences.handleDocumentsViewModeChange,
    onDocumentsSortFieldChange: documentsPreferences.handleDocumentsSortFieldChange,
    onDocumentsSortDirectionToggle: documentsPreferences.handleDocumentsSortDirectionToggle,
    searchIncludeDescendants: documentsPreferences.searchIncludeDescendants,
    onSetSearchIncludeDescendants: documentsPreferences.setSearchIncludeDescendants,
  });

  if (['logged-out', 'authenticating', 'selecting-tenant'].includes(appStatus)) {
    const redirectTarget = `${location.pathname}${location.search}${location.hash || ''}`;
    return (
      <Navigate
        to="/account/login"
        replace
        state={{ from: redirectTarget }}
      />
    );
  }

  return (
    <DomainProviderStack domains={domains}>
      <div className="app-shell" ref={shellRef}>
        <DropOverlay
          active={dropOverlayState.active}
          folderName={dropOverlayState.folderName}
        />
        <UploadQueueOverlay
          queue={domains.ui.uploadQueue || []}
          onClearQueue={domains.ui.clearUploadQueue}
          onDocumentClick={(documentId) => domains.workspace.openDocumentViewerForDetail({ documentIds: [documentId] })}
        />
        <StatusToastOverlay />
        <Outlet />
        {managementModals}
        {settingsOpen ? (
          <SettingsRoute open onClose={closeSettings} />
        ) : null}
      </div>
    </DomainProviderStack>
  );
};

const TenantAwareLayout: React.FC = () => {
  const { tenant } = useAppState();
  // Force remount when tenant changes to ensure clean state (folders, selection, etc.)
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

if (!container) {
  throw new Error('App root element #app not found');
}

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
