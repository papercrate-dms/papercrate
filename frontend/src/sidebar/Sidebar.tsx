import React, { useRef } from 'react';
import { usePanelResizeBindings } from '../app/PanelManagerContext';
import { useSession } from '../lib/context/SessionContext';
import { useUI } from '../lib/context/UIContext';
import { useTags } from '../lib/context/TagsContext';
import { useCorrespondents } from '../lib/context/CorrespondentsContext';
import { useFolderTree } from '../lib/context/FolderTreeContext';
import SidebarFolderList from './components/SidebarFolderList';
import SidebarTagList from './components/SidebarTagList';
import SidebarCorrespondentList from './components/SidebarCorrespondentList';
import type { TenantOption } from './components/SidebarMenu';
import SidebarHeader from './components/SidebarHeader';
import SidebarSearch from './components/SidebarSearch';

const Sidebar: React.FC = () => {
  const { tags, handleTagCreate, openTagsModal } = useTags();
  const { correspondents, handleCorrespondentCreate, openCorrespondentsModal } = useCorrespondents();
  const { handleLogout, tenant, tenants, tenantOptions, handleTenantSelect } = useSession();
  const { openSettings, handleFileSelection, sidebarSuppressed } = useUI();
  const { selectedFolder } = useFolderTree();

  const tenantName = (tenant as TenantOption)?.name;
  const effectiveTenants = (tenants || tenantOptions || []);
  const activeTenantId = (tenant as TenantOption)?.id;

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
        onUploadFiles={handleFileSelection}
        selectedFolder={selectedFolder}
      />

      <div className="panel-body sidebar__body">
        <SidebarSearch />

        <SidebarFolderList />

        <SidebarTagList
          tags={tags}
          untaggedFilterId={null}
          onCreateTag={handleTagCreate}
          onManageTags={openTagsModal}
        />

        <SidebarCorrespondentList
          correspondents={correspondents}
          onCreateCorrespondent={handleCorrespondentCreate}
          onManageCorrespondents={openCorrespondentsModal}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
