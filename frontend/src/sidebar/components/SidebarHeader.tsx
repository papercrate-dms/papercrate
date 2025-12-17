import React, { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
    SidebarCollapseIcon,
    ChevronDownIcon,
    UploadIcon,
    LogoIcon,
} from '../../components/icons';
import PanelHeader from '../../components/PanelHeader';
import useFloatingMenu from '../../components/useFloatingMenu';
import type { Identifier } from '../../types/identifiers';
import SidebarMenu, { TenantOption } from './SidebarMenu';
import { usePanelManager } from '../../app/PanelManagerContext';
import { FolderIdentifier } from './SidebarFolderNode';

type UploadHandler = (
    files: FileList | File[] | Iterable<File>,
    targetFolderId?: FolderIdentifier | null,
) => void;

interface SidebarHeaderProps {
    tenantName?: string | null;
    tenants: TenantOption[];
    activeTenantId: Identifier | null;
    onSelectTenant?: (tenant: TenantOption | null, options?: { refreshOnly?: boolean }) => void;
    onOpenSettings?: () => void;
    onLogout?: () => void;
    onUploadFiles?: UploadHandler;
    selectedFolder?: FolderIdentifier | null;
}

interface FloatingMenuControls {
    isOpen: boolean;
    toggle: () => void;
    close: () => void;
    menuRef: React.RefObject<HTMLDivElement>;
    menuStyle: CSSProperties | null;
    updatePosition: () => void;
}

const SidebarHeader: React.FC<SidebarHeaderProps> = ({
    tenantName,
    tenants,
    activeTenantId,
    onSelectTenant,
    onOpenSettings,
    onLogout,
    onUploadFiles,
    selectedFolder,
}) => {
    const { collapseSidebar } = usePanelManager();
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const tenantButtonRef = useRef<HTMLButtonElement | null>(null);

    const {
        isOpen: tenantMenuOpen,
        toggle: toggleTenantMenuFloating,
        close: closeTenantMenu,
        menuRef: tenantMenuRef,
        menuStyle: tenantMenuStyle,
        updatePosition: refreshTenantMenuPosition,
    } = useFloatingMenu({
        anchorRef: tenantButtonRef,
        minWidth: 220,
        offset: 6,
    }) as FloatingMenuControls;

    const toggleTenantMenu = useCallback(() => {
        if (!tenantMenuOpen && tenants.length === 0 && onSelectTenant) {
            onSelectTenant(null, { refreshOnly: true });
        }
        toggleTenantMenuFloating();
    }, [tenantMenuOpen, tenants.length, onSelectTenant, toggleTenantMenuFloating]);

    useEffect(() => {
        if (tenantMenuOpen) {
            refreshTenantMenuPosition();
        }
    }, [tenantMenuOpen, refreshTenantMenuPosition, tenants.length]);

    const handleCollapse = useCallback(() => {
        collapseSidebar();
    }, [collapseSidebar]);

    const handleUploadButtonClick = useCallback(() => {
        if (!onUploadFiles || !uploadInputRef.current) {
            return;
        }
        uploadInputRef.current.click();
    }, [onUploadFiles]);

    const handleUploadInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const files = event.target?.files;
            if (files && files.length && onUploadFiles) {
                onUploadFiles(files, selectedFolder ?? 'root');
            }
            if (event.target) {
                event.target.value = '';
            }
        },
        [onUploadFiles, selectedFolder],
    );

    return (
        <>
            <input
                type="file"
                ref={uploadInputRef}
                style={{ display: 'none' }}
                multiple
                onChange={handleUploadInputChange}
            />
            <PanelHeader
                leading={(
                    <>
                        <button
                            type="button"
                            className={`sidebar__title-button${tenantMenuOpen ? ' is-open' : ''}`}
                            onClick={toggleTenantMenu}
                            aria-haspopup="true"
                            aria-expanded={tenantMenuOpen}
                            ref={tenantButtonRef}
                        >
                            <span className="sidebar__title">
                                <LogoIcon className="sidebar__logo" variant="small" />
                                <span className="sidebar__title-text">Papercrate</span>
                                {tenantName ? <span className="sidebar__tenant"> / {tenantName}</span> : null}
                            </span>
                            <ChevronDownIcon
                                className={`sidebar__title-chevron${tenantMenuOpen ? ' is-open' : ''}`}
                                size={16}
                            />
                        </button>
                        <SidebarMenu
                            isOpen={tenantMenuOpen}
                            menuRef={tenantMenuRef}
                            style={tenantMenuStyle}
                            tenants={tenants}
                            activeTenantId={activeTenantId}
                            onSelectTenant={onSelectTenant}
                            onOpenSettings={onOpenSettings}
                            onLogout={onLogout}
                            onClose={closeTenantMenu}
                        />
                    </>
                )}
                actions={(
                    <>
                        <button
                            type="button"
                            className="icon-button sidebar__collapse-button"
                            onClick={handleCollapse}
                            aria-label="Collapse sidebar"
                            title="Collapse sidebar"
                        >
                            <SidebarCollapseIcon />
                        </button>
                        <button
                            type="button"
                            className="icon-button"
                            onClick={handleUploadButtonClick}
                            disabled={!onUploadFiles}
                            title="Upload documents"
                            aria-label="Upload documents"
                        >
                            <UploadIcon size={18} />
                        </button>
                    </>
                )}
            />
        </>
    );
};

export default SidebarHeader;
