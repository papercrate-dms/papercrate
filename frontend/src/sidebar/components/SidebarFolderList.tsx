import React, { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Identifier } from '../../types/identifiers';
import { FolderPlusIcon } from '../../components/icons';
import FolderNode, { FolderIdentifier } from './SidebarFolderNode';
import type { FolderTreeNode } from '../../lib/api/apiTypes';
import { useAppShell } from '../../lib/context/AppShellContext';
import FoldersManager from '../../documents/FoldersManager';
import { useSyncExternalStore } from 'react';

interface SidebarFolderListProps {
    selectedFolder: FolderIdentifier | null;
    onSelect: (folderId: FolderIdentifier) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>, folderId: FolderIdentifier) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>, folderId: FolderIdentifier) => void;
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
    onDeleteFolder: (folderId: FolderIdentifier) => void;
    onRenameFolder?: (folderId: FolderIdentifier, name: string) => void;
    onFolderDragStart?: (event: React.DragEvent<HTMLDivElement>, folderId: FolderIdentifier) => void;
    onFolderDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
    draggedFolderId?: FolderIdentifier | null;
    onCreateFolder?: (parentId?: Identifier | null) => void;
    creatingFolder?: boolean;
}

const SidebarFolderList: React.FC<SidebarFolderListProps> = ({
    selectedFolder,
    onSelect,
    onDrop,
    onDragOver,
    onDragLeave,
    onDeleteFolder,
    onRenameFolder,
    onFolderDragStart,
    onFolderDragEnd,
    draggedFolderId,
    onCreateFolder,
    creatingFolder,
}) => {
    const shell = useAppShell() as any;
    const foldersManager = shell.folderTree?.foldersManager;

    const getTreeSnapshot = useCallback(() => {
        if (!foldersManager) return [];
        return (foldersManager as FoldersManager).getTreeSnapshot();
    }, [foldersManager]);

    const getFolderMap = useCallback(() => {
        if (!foldersManager) return new Map();
        return (foldersManager as FoldersManager).getSnapshot();
    }, [foldersManager]);

    const subscribeToTree = useCallback((callback: () => void) => {
        if (!foldersManager) return () => { };
        return (foldersManager as FoldersManager).subscribe(callback);
    }, [foldersManager]);

    const roots = useSyncExternalStore(subscribeToTree, getTreeSnapshot);
    const folderMap = useSyncExternalStore(subscribeToTree, getFolderMap);
    const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set(['root']));

    // Auto-expand ancestors when selected folder changes
    React.useEffect(() => {
        if (!selectedFolder || !folderMap) return;

        const ancestors = new Set<string>();
        let current = folderMap.get(String(selectedFolder));

        while (current) {
            const parentId = current.parentId || current.parent_id;
            if (!parentId || parentId === 'root') break;

            ancestors.add(String(parentId));
            current = folderMap.get(String(parentId));
        }

        if (ancestors.size > 0) {
            setExpandedIds((prev) => {
                const next = new Set(prev);
                let changed = false;
                ancestors.forEach(id => {
                    if (!next.has(id)) {
                        next.add(id);
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }
    }, [selectedFolder, folderMap]);

    const handleToggle = useCallback((folderId: FolderIdentifier) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            const id = String(folderId);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const renderNodes = useCallback(
        (nodes: FolderTreeNode[], depth: number): ReactNode =>
            nodes.map((node) => {
                const isExpanded = expandedIds.has(String(node.id));
                const liveNode = folderMap.get(String(node.id));
                const displayNode = liveNode ? { ...node, name: liveNode.name ?? node.name } : node;

                return (
                    <FolderNode
                        key={node.id}
                        node={displayNode}
                        depth={depth}
                        isSelected={selectedFolder === node.id}
                        onToggle={handleToggle}
                        expanded={isExpanded}
                        onSelect={onSelect}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDelete={onDeleteFolder}
                        onRename={onRenameFolder}
                        renderChildren={renderNodes}
                        onFolderDragStart={onFolderDragStart}
                        onFolderDragEnd={onFolderDragEnd}
                        draggingFolderId={draggedFolderId}
                        onCreateFolder={onCreateFolder}
                    />
                );
            }),
        [
            expandedIds,
            folderMap,
            selectedFolder,
            handleToggle,
            onSelect,
            onDrop,
            onDragOver,
            onDragLeave,
            onDeleteFolder,
            onRenameFolder,
            onFolderDragStart,
            onFolderDragEnd,
            draggedFolderId,
            onCreateFolder,
        ],
    );

    return (
        <div className="sidebar-section sidebar-section--folders">
            <div className="sidebar-section__header">
                <h3>Folders</h3>
                {onCreateFolder ? (
                    <div className="sidebar-section__actions">
                        <button
                            type="button"
                            className="icon-button"
                            onClick={() => onCreateFolder('root')}
                            aria-label="Create folder"
                            disabled={creatingFolder}
                        >
                            <FolderPlusIcon size={16} />
                        </button>
                    </div>
                ) : null}
            </div>
            <ul className="folder-tree">
                {renderNodes(roots as FolderTreeNode[], 0)}
            </ul>
        </div>
    );
};

export default SidebarFolderList;
