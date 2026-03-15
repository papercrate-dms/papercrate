import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { FolderNodeId } from '../../types/identifiers';

export interface DropOverlayState {
  active: boolean;
  folderName: string;
}

export interface UploadQueueItem {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

export interface UIContextValue {
  notifyApiError: (error: unknown, fallbackMessage?: string) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  managementModals: React.ReactNode;
  refreshCurrentFolder: () => Promise<void>;
  sidebarSuppressed?: boolean;
  // Upload
  handleFileSelection: (
    files: FileList | File[] | Iterable<File>,
    targetFolderId?: FolderNodeId | null,
  ) => void;
  handleFileDrop: (event: React.DragEvent<HTMLElement>) => void;
  uploadQueue: UploadQueueItem[];
  clearUploadQueue: () => void;
  dropOverlayState: DropOverlayState;
  resetUploadsState: () => void;
}

const [UICtx, useUI] = createSafeContext<UIContextValue>('UI');

export const UIProvider: React.FC<{ value: UIContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <UICtx.Provider value={value}>{children}</UICtx.Provider>
);

export { useUI };
