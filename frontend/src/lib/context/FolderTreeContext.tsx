import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { Identifier, FolderNodeId } from '../../types/identifiers';
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
  selectFolder: (folderId: FolderNodeId, options?: { immediate?: boolean }) => void;
  folderClickHandlers: FolderClickHandlers;
  handleFolderRename: (folderId: FolderNodeId, name: string) => Promise<boolean> | boolean;
  handleFolderDelete: (folderId: FolderNodeId) => Promise<void> | void;
  handleFolderDragStart: (event: React.DragEvent<HTMLElement>, folderId: FolderNodeId) => void;
  handleFolderDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  draggedFolderId: FolderNodeId | null;
  handlePromptCreateFolder: (parentId?: Identifier | null) => void;
  creatingFolder: boolean;
  refreshCurrentFolder: () => Promise<void>;
}

const [FolderTreeCtx, useFolderTree] = createSafeContext<FolderTreeContextValue>('FolderTree');

export const FolderTreeProvider: React.FC<{ value: FolderTreeContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <FolderTreeCtx.Provider value={value}>{children}</FolderTreeCtx.Provider>
);

export { useFolderTree };
