import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createSafeContext } from '../../utils/createSafeContext';
import { useFolder } from './FolderContext';
import { useTags } from './TagsContext';
import { useCorrespondents } from './CorrespondentsContext';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import { useManagementModals } from '../../app/useManagementModals';
import type { FolderNodeId } from '../../types/identifiers';
import type { ReactNode } from 'react';
import useDocumentUploads from '../../documents/features/upload/useDocumentUploads';

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
  refreshCurrentFolder: () => Promise<void>;
  // Management modals
  managementModals: ReactNode;
  openTagsModal: () => void;
  openCorrespondentsModal: () => void;
  // Upload
  handleFileSelection: (
    files: FileList | File[] | Iterable<File>,
    targetFolderId?: FolderNodeId | null,
  ) => void;
  handleFileDrop: (dataTransfer: DataTransfer, targetFolderId?: FolderNodeId | null) => void;
  uploadQueue: UploadQueueItem[];
  clearUploadQueue: () => void;
  dropOverlayState: DropOverlayState;
  resetUploadsState: () => void;
}

const [UICtx, useUI] = createSafeContext<UIContextValue>('UI');

export interface UIProviderProps {
  // Cross-domain dependency for upload shell element
  shellRef: React.MutableRefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export const UIProvider: React.FC<UIProviderProps> = ({
  shellRef,
  children,
}) => {
  const notifyApiError = useNotifyApiError();

  // --- Settings ---
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  // Read from providers above us in the stack.
  const { selectedFolder, currentFolderName, refreshCurrentFolder } = useFolder();
  const tagsCtx = useTags();
  const correspondentsCtx = useCorrespondents();
  const location = useLocation();

  const { managementModals, openTagsModal, openCorrespondentsModal } = useManagementModals({
    locationPathname: location.pathname,
    tags: tagsCtx.tags,
    refreshTags: tagsCtx.refreshTags,
    onTagCreate: tagsCtx.handleTagCreate as any,
    onTagUpdate: tagsCtx.handleTagUpdate as any,
    onTagDelete: tagsCtx.handleTagDelete as any,
    correspondents: correspondentsCtx.correspondents,
    refreshCorrespondents: correspondentsCtx.refreshCorrespondents,
    onCorrespondentCreate: correspondentsCtx.handleCorrespondentCreate as any,
    onCorrespondentUpdate: correspondentsCtx.handleCorrespondentUpdate as any,
    onCorrespondentDelete: correspondentsCtx.handleCorrespondentDelete as any,
  });

  const upload = useDocumentUploads({
    selectedFolder,
    currentFolderName,
    refreshCurrentFolder,
    shellRef,
  });

  const value: UIContextValue = {
    notifyApiError,
    settingsOpen,
    openSettings,
    closeSettings,
    refreshCurrentFolder,
    managementModals,
    openTagsModal,
    openCorrespondentsModal,
    handleFileSelection: upload.handleFileSelection,
    handleFileDrop: upload.handleFileDrop,
    uploadQueue: upload.uploadQueue,
    clearUploadQueue: upload.clearUploadQueue,
    dropOverlayState: upload.dropOverlayState,
    resetUploadsState: upload.resetUploadsState,
  };

  return <UICtx.Provider value={value}>{children}</UICtx.Provider>;
};

export { useUI };
