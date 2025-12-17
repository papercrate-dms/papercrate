import React, { useRef } from 'react';
import { useAppShell } from '../lib/context/AppShellContext';
import { usePanelResizeBindings } from '../app/PanelManagerContext';
import SidebarFolderList from './components/SidebarFolderList';
import SidebarTagList from './components/SidebarTagList';
import SidebarCorrespondentList from './components/SidebarCorrespondentList';
import { TenantOption } from './components/SidebarMenu';
import SidebarHeader from './components/SidebarHeader';
import SidebarSearch from './components/SidebarSearch';

const Sidebar: React.FC = () => {
  const shell = useAppShell() as any;
  const {
    openTagsModal,
    handleTagCreate,
    tags = [],
  } = shell.tags || {};
  const {
    openCorrespondentsModal,
    handleCorrespondentCreate,
    correspondents = [],
  } = shell.correspondents || {};
  const {
    handleLogout,
    tenant,
    tenants,
    tenantOptions,
    handleTenantSelect,
  } = shell.session || {};
  const {
    openSettings,
  } = shell.ui || {};
  const {
    handleFileSelection,
  } = shell.upload || {};
  const {
    folderClickHandlers = {},
    handleFolderDelete,
    handleFolderRename,
    selectedFolder = null,
    handleFolderDragStart,
    handleFolderDragEnd,
    draggedFolderId = null,
    handlePromptCreateFolder,
    creatingFolder = false,
  } = shell.folderTree || {};

  const sidebarSuppressed = shell.ui?.sidebarSuppressed;

  const onSelect = folderClickHandlers.onSelect;
  const onDrop = folderClickHandlers.onDrop;
  const onDragOver = folderClickHandlers.onDragOver;
  const onDragLeave = folderClickHandlers.onDragLeave;

  const onManageTags = openTagsModal;
  const onManageCorrespondents = openCorrespondentsModal;

  // Derived or context-based handlers/values
  const tenantName = (tenant as TenantOption)?.name;
  const effectiveTenants = (tenants || tenantOptions || []);
  const activeTenantId = (tenant as TenantOption)?.id;

  const onUploadFiles = handleFileSelection;

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const {
    panelStyle: sidebarStyle,
    handleProps: sidebarHandleProps,
    isPanelResizing: isResizingSidebar,
  } = usePanelResizeBindings('sidebar', { panelRef: sidebarRef });

  const sidebarClassNames = ['sidebar'];
  if (isResizingSidebar) {
    sidebarClassNames.push('sidebar--resizing');
  }
  if (sidebarSuppressed) {
    sidebarClassNames.push('sidebar--suppressed');
  }

  return (
    <aside className={sidebarClassNames.join(' ')} ref={sidebarRef} style={sidebarStyle}>
      <button
        type="button"
        className={`resize-handle resize-handle--right${isResizingSidebar ? ' is-active' : ''}`}
        aria-label="Resize sidebar"
        {...sidebarHandleProps}
      >
        <span className="resize-handle__line" aria-hidden="true" />
      </button>

      <SidebarHeader
        tenantName={tenantName}
        tenants={effectiveTenants}
        activeTenantId={activeTenantId}
        onSelectTenant={handleTenantSelect}
        onOpenSettings={openSettings}
        onLogout={handleLogout}
        onUploadFiles={onUploadFiles}
        selectedFolder={selectedFolder}
      />

      <div className="panel-body sidebar__body">
        <SidebarSearch />

        <SidebarFolderList
          selectedFolder={selectedFolder}
          onSelect={onSelect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDeleteFolder={handleFolderDelete}
          onRenameFolder={handleFolderRename}
          onFolderDragStart={handleFolderDragStart}
          onFolderDragEnd={handleFolderDragEnd}
          draggedFolderId={draggedFolderId}
          onCreateFolder={handlePromptCreateFolder}
          creatingFolder={creatingFolder}
        />

        <SidebarTagList
          tags={tags}
          untaggedFilterId={null}
          onCreateTag={handleTagCreate}
          onManageTags={onManageTags}
        />

        <SidebarCorrespondentList
          correspondents={correspondents}
          onCreateCorrespondent={handleCorrespondentCreate}
          onManageCorrespondents={onManageCorrespondents}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
