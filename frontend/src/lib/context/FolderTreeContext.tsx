import React, { useCallback, useState } from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import { useFolder } from './FolderContext';
import { useUI } from './UIContext';
import { useStatusToast } from './StatusToastContext';
import useFolderTreeActions from '../../documents/features/folders/useFolderTreeActions';
import type { DocumentId, Identifier, FolderNodeId } from '../../types/identifiers';
import type FoldersManager from '../../documents/FoldersManager';

export interface FolderClickHandlers {
  onSelect?: (folderId: FolderNodeId) => void;
  onDrop?: (event: React.DragEvent<HTMLElement>, folderId: FolderNodeId) => void;
  onDragOver?: (event: React.DragEvent<HTMLElement>, folderId: FolderNodeId) => void;
  onDragLeave?: (event: React.DragEvent<HTMLElement>) => void;
}

export interface BreadcrumbEntry {
  id: Identifier | 'root';
  name: string;
}

export interface FolderOption {
  id: FolderNodeId;
  label: string;
}

export interface FolderTreeContextValue {
  foldersManager: FoldersManager;
  selectedFolder: FolderNodeId;
  currentFolderName: string;
  folderOptions: FolderOption[];
  breadcrumbs: BreadcrumbEntry[];
  currentSubfolders: unknown[];
  moveDocumentsToFolder: (documentIds: unknown[], targetFolderId?: FolderNodeId | null) => Promise<void>;
  handleBreadcrumbNavigate: (crumb: { id?: Identifier | string } | null) => void;
  resolveFolderPath: (folderId?: FolderNodeId) => BreadcrumbEntry[];
  selectFolder: (folderId: FolderNodeId | null) => void;
  folderClickHandlers: FolderClickHandlers;
  handleFolderRename: (folderId: FolderNodeId, name: string) => Promise<boolean> | boolean;
  handleFolderDelete: (folderId: FolderNodeId) => Promise<void> | void;
  handleFolderCreate: (name: string, parentId?: Identifier | null) => Promise<boolean>;
  handleFolderDragStart: (event: React.DragEvent<HTMLElement>, folderId: FolderNodeId) => void;
  handleFolderDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  draggedFolderId: FolderNodeId | null;
  handlePromptCreateFolder: (parentId?: Identifier | null) => void;
  creatingFolder: boolean;
  refreshCurrentFolder: () => Promise<void>;
}

const [FolderTreeCtx, useFolderTree] = createSafeContext<FolderTreeContextValue>('FolderTree');

interface FolderTreeProviderProps {
  /** Cross-domain: document move mutation */
  moveDocumentsToFolder: (documentIds: unknown[], targetFolderId?: FolderNodeId | null) => Promise<void>;
  /** Drag state from the workspace orchestration layer */
  draggedDocumentIds: DocumentId[];
  draggedFolderId: FolderNodeId | null;
  setDraggedDocumentIds: (ids: DocumentId[]) => void;
  setDraggedFolderId: (id: FolderNodeId | null) => void;
  /** Folder drag handlers from useDocumentDragHandlers */
  handleFolderDragStart: (event: React.DragEvent<HTMLElement>, folderId: FolderNodeId) => void;
  handleFolderDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  children: React.ReactNode;
}

export const FolderTreeProvider: React.FC<FolderTreeProviderProps> = ({
  moveDocumentsToFolder,
  draggedDocumentIds,
  draggedFolderId,
  setDraggedDocumentIds,
  setDraggedFolderId,
  handleFolderDragStart,
  handleFolderDragEnd,
  children,
}) => {
  const folder = useFolder();
  const { handleFileDrop } = useUI();
  const { showToast } = useStatusToast();
  const [creatingFolder, setCreatingFolder] = useState(false);

  const folderState = {
    folderNodes: folder.folderNodes,
    selectedFolder: folder.selectedFolder,
    setSelectedFolder: folder.setSelectedFolder,
    setCreatingFolder,
    foldersManager: folder.foldersManager,
  };

  const dragState = {
    draggedDocumentIds,
    draggedFolderId,
    setDraggedDocumentIds,
    setDraggedFolderId,
  };

  const folderActions = useFolderTreeActions({
    folderState,
    dragState,
    actions: {
      handleFileDrop,
      moveDocumentsToFolder,
    },
    utils: {
      isInvalidFolderDrop: folder.isInvalidFolderDrop,
    },
  });

  const handleBreadcrumbNavigate = useCallback(
    (crumb: { id?: Identifier | string } | null) => {
      if (!crumb || !crumb.id) return;
      const folderId = crumb.id === 'root' ? 'root' : crumb.id;
      folderActions.selectFolder(folderId);
    },
    [folderActions.selectFolder],
  );

  const handlePromptCreateFolder = useCallback(
    async (parentId?: Identifier | null) => {
      if (creatingFolder) return;
      const input = window.prompt('New folder name');
      if (!input) return;
      const trimmed = input.trim();
      if (!trimmed) {
        showToast('Folder name cannot be empty.', 'error');
        return;
      }
      setCreatingFolder(true);
      try {
        const success = await folderActions.handleFolderCreate(trimmed, parentId);
        if (!success) {
          showToast('Unable to create folder. Check the status message for details.', 'error');
        }
      } finally {
        setCreatingFolder(false);
      }
    },
    [creatingFolder, folderActions.handleFolderCreate, showToast],
  );

  const value: FolderTreeContextValue = {
    foldersManager: folder.foldersManager,
    selectedFolder: folder.selectedFolder,
    currentFolderName: folder.currentFolderName,
    folderOptions: folder.folderOptions,
    breadcrumbs: folder.breadcrumbs,
    currentSubfolders: folder.visibleSubfolders,
    resolveFolderPath: folder.resolveFolderPath,
    refreshCurrentFolder: folder.refreshCurrentFolder,
    moveDocumentsToFolder,
    handleBreadcrumbNavigate,
    selectFolder: folderActions.selectFolder,
    folderClickHandlers: folderActions.folderClickHandlers,
    handleFolderRename: folderActions.handleFolderRename,
    handleFolderDelete: folderActions.handleFolderDelete,
    handleFolderCreate: folderActions.handleFolderCreate,
    handleFolderDragStart,
    handleFolderDragEnd,
    draggedFolderId,
    handlePromptCreateFolder,
    creatingFolder,
  };

  return <FolderTreeCtx.Provider value={value}>{children}</FolderTreeCtx.Provider>;
};

export { useFolderTree };
