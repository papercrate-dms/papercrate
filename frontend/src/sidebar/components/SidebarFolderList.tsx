import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { FolderNodeId } from '../../types/identifiers';
import { FolderPlusIcon } from '../../components/icons';
import TrashBinIcon from '../../components/icons/TrashBinIcon';
import FolderNode from './SidebarFolderNode';
import type { FolderTreeNode } from '../../lib/api/apiTypes';
import { useFolderTree } from '../../lib/context/FolderTreeContext';
import type FoldersManager from '../../documents/FoldersManager';

const SidebarFolderList: React.FC = () => {
    const {
        foldersManager,
        selectedFolder,
        folderClickHandlers,
        handleFolderDelete,
        handleFolderRename,
        handleFolderDragStart,
        handleFolderDragEnd,
        draggedFolderId,
        handlePromptCreateFolder,
        creatingFolder,
    } = useFolderTree();

    const onSelect = folderClickHandlers.onSelect;
    const onDrop = folderClickHandlers.onDrop;
    const onDragOver = folderClickHandlers.onDragOver;
    const onDragLeave = folderClickHandlers.onDragLeave;

    const getTreeSnapshot = useCallback(() => {
        return (foldersManager as FoldersManager).getTreeSnapshot();
    }, [foldersManager]);

    const getFolderMap = useCallback(() => {
        return (foldersManager as FoldersManager).getSnapshot();
    }, [foldersManager]);

    const subscribeToTree = useCallback((callback: () => void) => {
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

    const handleToggle = useCallback((folderId: FolderNodeId) => {
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
                        onDelete={handleFolderDelete}
                        onRename={handleFolderRename}
                        renderChildren={renderNodes}
                        onFolderDragStart={handleFolderDragStart}
                        onFolderDragEnd={handleFolderDragEnd}
                        draggingFolderId={draggedFolderId}
                        onCreateFolder={handlePromptCreateFolder}
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
            handleFolderDelete,
            handleFolderRename,
            handleFolderDragStart,
            handleFolderDragEnd,
            draggedFolderId,
            handlePromptCreateFolder,
        ],
    );

    const trashNode: FolderTreeNode = useMemo(() => ({
        id: 'trash',
        name: 'Trash',
        children: [],
    }), []);

    const trashIcon = useMemo(() => <TrashBinIcon className="folder-icon-image" size={16} />, []);

    const noopToggle = useCallback(() => {}, []);
    const noopDelete = useCallback(() => {}, []);
    const noopRenderChildren = useCallback(() => null, []);

    return (
        <div className="sidebar-section sidebar-section--folders">
            <div className="sidebar-section__header">
                <h3>Folders</h3>
                {handlePromptCreateFolder ? (
                    <div className="sidebar-section__actions">
                        <button
                            type="button"
                            className="icon-button"
                            onClick={() => handlePromptCreateFolder('root')}
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
                <FolderNode
                    node={trashNode}
                    depth={0}
                    isSelected={selectedFolder === 'trash'}
                    onToggle={noopToggle}
                    onSelect={onSelect}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDelete={noopDelete}
                    renderChildren={noopRenderChildren}
                    expanded={false}
                    icon={trashIcon}
                    showActions={false}
                />
            </ul>
        </div>
    );
};

export default SidebarFolderList;
