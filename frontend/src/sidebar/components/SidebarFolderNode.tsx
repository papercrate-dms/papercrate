import React from 'react';
import type { ReactNode } from 'react';
import {
    ChevronIcon,
    TrashIcon,
    EditIcon,
    FolderIcon,
    FolderPlusIcon,
} from '../../components/icons';
import type { Identifier } from '../../types/identifiers';

import type { FolderTreeNode } from '../../lib/api/apiTypes';

export type FolderIdentifier = Identifier | 'root';

interface FolderNodeProps {
    node: FolderTreeNode;
    depth: number;
    isSelected: boolean;
    onToggle: (folderId: FolderIdentifier) => void;
    onSelect: (folderId: FolderIdentifier) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>, folderId: FolderIdentifier) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>, folderId: FolderIdentifier) => void;
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
    onDelete: (folderId: FolderIdentifier) => void;
    onRename?: (folderId: FolderIdentifier, name: string) => void;
    renderChildren: (nodes: FolderTreeNode[], depth: number) => ReactNode;
    expanded: boolean;
    onFolderDragStart?: (event: React.DragEvent<HTMLDivElement>, folderId: FolderIdentifier) => void;
    onFolderDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
    draggingFolderId?: FolderIdentifier | null;
    onCreateFolder?: (parentId?: Identifier | null) => void;
}

const FolderNode: React.FC<FolderNodeProps> = ({
    node,
    depth,
    isSelected,
    onToggle,
    onSelect,
    onDrop,
    onDragOver,
    onDragLeave,
    onDelete,
    onRename,
    renderChildren,
    expanded,
    onFolderDragStart,
    onFolderDragEnd,
    draggingFolderId,
    onCreateFolder,
}) => {
    const isRoot = node.id === 'root';
    const childNodes = node.children || [];
    const hasChildren = childNodes.length > 0;
    const canToggle = hasChildren; // Simplified: only toggle if we have children to show
    const showChevron = canToggle;
    const icon = showChevron ? <ChevronIcon className="toggle-icon" /> : null;
    const canDrag = !isRoot;
    const isDragging = draggingFolderId === node.id;
    const isExpanded = expanded;
    const rowClasses = ['folder-row'];
    if (isSelected) {
        rowClasses.push('active');
    }

    const handleToggleClick = (event: React.MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        if (canToggle) {
            onToggle(node.id);
        }
    };

    return (
        <li className={`folder-node${isDragging ? ' is-dragging' : ''}`}>
            <div
                className={rowClasses.join(' ')}
                draggable={canDrag}
                onClick={() => onSelect(node.id)}
                onDoubleClick={() => {
                    if (canToggle) {
                        onToggle(node.id);
                    }
                }}
                onDragOver={(event) => onDragOver(event, node.id)}
                onDragLeave={onDragLeave}
                onDrop={(event) => onDrop(event, node.id)}
                onDragStart={(event) => {
                    if (!canDrag || !onFolderDragStart) return;
                    onFolderDragStart(event, node.id);
                }}
                onDragEnd={(event) => {
                    onFolderDragEnd?.(event);
                }}
            >
                <span
                    className={`toggle${showChevron ? '' : ' invisible'}${isExpanded ? ' expanded' : ''}`}
                    onClick={handleToggleClick}
                >
                    {icon}
                </span>
                <span className="name-wrap">
                    <FolderIcon className="folder-icon-image" size={16} />
                    <span className="name__label" title={node.name}>
                        {node.name}
                    </span>
                </span>
                <div className="folder-row__actions">
                    <button
                        type="button"
                        className="icon-button ghost"
                        onClick={(event) => {
                            event.stopPropagation();
                            onCreateFolder?.(node.id);
                        }}
                        title="Create subfolder"
                        aria-label={`Create subfolder in ${node.name}`}
                    >
                        <FolderPlusIcon className="icon-edit" size={18} />
                    </button>
                    {node.id !== 'root' && (
                        <>
                            <button
                                type="button"
                                className="icon-button ghost"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    if (!onRename) return;
                                    const nextName = window.prompt('Rename folder', node.name);
                                    if (!nextName) {
                                        return;
                                    }
                                    const trimmed = nextName.trim();
                                    if (!trimmed || trimmed === node.name) {
                                        return;
                                    }
                                    onRename(node.id, trimmed);
                                }}
                                title="Rename folder"
                                aria-label={`Rename folder ${node.name}`}
                            >
                                <EditIcon className="icon-edit" size={18} />
                            </button>
                            <button
                                type="button"
                                className="icon-button ghost"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDelete(node.id);
                                }}
                                title="Delete folder"
                                aria-label={`Delete folder ${node.name}`}
                            >
                                <TrashIcon className="icon-trash" size={18} />
                            </button>
                        </>
                    )}
                </div>
            </div>
            {isExpanded && childNodes.length > 0 && (
                <ul className={`folder-children${depth === 0 ? ' folder-children--level1' : ''}`}>
                    {renderChildren(childNodes, depth + 1)}
                </ul>
            )}
        </li>
    );
};

export default FolderNode;
