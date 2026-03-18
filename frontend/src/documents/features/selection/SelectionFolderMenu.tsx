import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useFloatingMenu from '../../../components/useFloatingMenu';
import {
    ArrowLeftIcon,
    FolderIcon,
    FolderMoveIcon,
} from '../../../components/icons';
import type { FolderTreeNode } from '../../../lib/api/apiTypes';
import type { DocumentId } from '../../../types/identifiers';

interface SelectionFolderMenuProps {
    label: React.ReactNode;
    folderTree?: FolderTreeNode[];
    onSelectFolder?: (folderId: DocumentId | null) => Promise<void> | void;
    disabled?: boolean;
    className?: string;
    triggerContent?: React.ReactNode;
    triggerClassName?: string;
    placeholder?: string;
    emptyMessage?: string;
    onOpenMenu?: () => void;
    positionStrategy?: 'absolute' | 'fixed';
    rootTitle?: string;
}

const SelectionFolderMenu: React.FC<SelectionFolderMenuProps> = ({
    label,
    folderTree = [],
    onSelectFolder,
    disabled = false,
    className,
    triggerContent = null,
    triggerClassName = 'quick-add__chip quick-add__trigger',
    placeholder = 'Search folders…',
    emptyMessage = 'No folders',
    onOpenMenu,
    positionStrategy = 'absolute',
    rootTitle = 'Folders',
}) => {
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [query, setQuery] = useState('');
    const [currentFolderId, setCurrentFolderId] = useState<DocumentId | null>(null);
    const [pending, setPending] = useState(false);

    const {
        isOpen,
        toggle,
        close,
        menuRef,
        menuStyle,
        updatePosition,
    } = useFloatingMenu({
        anchorRef,
        align: 'center',
        positionStrategy,
        minWidth: 260,
    }) as {
        isOpen: boolean;
        toggle: () => void;
        close: () => void;
        menuRef: React.MutableRefObject<HTMLDivElement | null>;
        menuStyle: CSSProperties | null;
        updatePosition: () => void;
    };

    useEffect(() => {
        if (disabled && isOpen) {
            close();
        }
    }, [disabled, isOpen, close]);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }
        setQuery('');
        setCurrentFolderId('root');
        setPending(false);
        const frame = requestAnimationFrame(() => {
            updatePosition();
            if (inputRef.current) {
                inputRef.current.focus();
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [isOpen, updatePosition]);

    // Build a flat map for easy lookup
    const { nodeMap, parentMap } = useMemo(() => {
        const nMap = new Map<DocumentId, FolderTreeNode>();
        const pMap = new Map<DocumentId, DocumentId>();

        const traverse = (nodes: FolderTreeNode[], parentId: DocumentId | null) => {
            nodes.forEach((node) => {
                nMap.set(node.id, node);
                if (parentId) {
                    pMap.set(node.id, parentId);
                }
                if (node.children) {
                    traverse(node.children, node.id);
                }
            });
        };
        traverse(folderTree, null);
        return { nodeMap: nMap, parentMap: pMap };
    }, [folderTree]);

    const currentFolder = currentFolderId ? nodeMap.get(currentFolderId) : null;

    const isSearching = query.trim().length > 0;

    const displayedItems = useMemo(() => {
        if (isSearching) {
            const search = query.trim().toLowerCase();
            const results: FolderTreeNode[] = [];
            nodeMap.forEach((node) => {
                if (node.name.toLowerCase().includes(search)) {
                    results.push(node);
                }
            });
            return results;
        }
        return currentFolderId
            ? (nodeMap.get(currentFolderId)?.children || [])
            : folderTree;
    }, [isSearching, query, currentFolderId, nodeMap, folderTree]);

    const handleTriggerClick = useCallback(() => {
        if (disabled) {
            return;
        }
        if (!isOpen) {
            onOpenMenu?.();
        }
        toggle();
    }, [disabled, isOpen, onOpenMenu, toggle]);

    const handleSelect = useCallback(
        async (folderId: DocumentId | null) => {
            if (!onSelectFolder) return;
            setPending(true);
            try {
                await onSelectFolder(folderId);
                close();
            } catch (error) {
                console.error('Failed to move to folder', error);
            } finally {
                setPending(false);
            }
        },
        [onSelectFolder, close]
    );

    const handleNavigate = (folderId: DocumentId) => {
        setCurrentFolderId(folderId);
        setQuery(''); // Clear search on navigation
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    const handleUp = () => {
        if (!currentFolderId) return;
        const parentId = parentMap.get(currentFolderId) || null;
        setCurrentFolderId(parentId);
    };

    return (
        <div className={className ? `selection-assignment ${className}` : 'selection-assignment'}>
            <button
                type="button"
                ref={anchorRef}
                className={triggerClassName}
                onClick={handleTriggerClick}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                disabled={disabled}
            >
                {triggerContent ? triggerContent : (
                    <span className="quick-add__chip-label">
                        {label}
                    </span>
                )}
            </button>
            {isOpen ? (
                <div
                    className="menu menu--floating selection-assignment__menu"
                    ref={menuRef}
                    style={menuStyle || undefined}
                    role="menu"
                    data-floating-position
                >
                    <div className="selection-assignment__header">
                        {/* Search Bar */}
                        <div className="selection-assignment__form">
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={placeholder}
                                aria-label={placeholder}
                                disabled={pending}
                            />
                        </div>

                        {/* Navigation Header (only if not searching) */}
                        {!isSearching && (
                            <div className="selection-assignment__header-nav">
                                <div className="selection-assignment__nav-title">
                                    {currentFolderId && currentFolderId !== 'root' ? (
                                        <button
                                            type="button"
                                            className="icon-button"
                                            onClick={handleUp}
                                            aria-label="Go up"
                                            title="Go up"
                                        >
                                            <ArrowLeftIcon size="1em" />
                                        </button>
                                    ) : null}
                                    <span
                                        className="selection-assignment__folder-name"
                                    >
                                        {currentFolder ? currentFolder.name : rootTitle}
                                    </span>
                                </div>

                                <div className="selection-assignment__nav-actions">
                                    <button
                                        type="button"
                                        className="icon-button"
                                        onClick={() => handleSelect(currentFolderId)}
                                        disabled={pending}
                                        title="Move here"
                                        aria-label="Move here"
                                    >
                                        <FolderMoveIcon size="1em" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="selection-assignment__list" role="presentation">
                        {displayedItems.length ? (
                            displayedItems.map((item) => {
                                const hasChildren = item.children && item.children.length > 0;
                                return (
                                    <div
                                        key={item.id}
                                        className={`menu__item selection-assignment__item${!hasChildren ? ' selection-assignment__item--empty' : ''}`}
                                        role="menuitem"
                                    >
                                        {/* Clickable area to navigate down */}
                                        <button
                                            type="button"
                                            className="selection-assignment__item-content"
                                            onClick={() => hasChildren && handleNavigate(item.id)}
                                            style={{ cursor: hasChildren ? 'pointer' : 'default' }}
                                        >
                                            <FolderIcon className="selection-assignment__icon" aria-hidden="true" />
                                            <span className="selection-assignment__folder-name">
                                                {item.name}
                                                {isSearching && parentMap.get(item.id) && (
                                                    <span className="selection-assignment__folder-path">
                                                        (in {nodeMap.get(parentMap.get(item.id)!)?.name})
                                                    </span>
                                                )}
                                            </span>
                                        </button>

                                        {/* Move Button for this specific folder */}
                                        <div className="selection-assignment__item-actions">
                                            <button
                                                type="button"
                                                className="icon-button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSelect(item.id);
                                                }}
                                                title={`Move to ${item.name}`}
                                                aria-label={`Move to ${item.name}`}
                                            >
                                                <FolderMoveIcon size="1em" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="menu__empty selection-assignment__empty">{emptyMessage}</div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default SelectionFolderMenu;
