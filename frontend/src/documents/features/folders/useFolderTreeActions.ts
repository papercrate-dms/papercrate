import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DragEvent } from 'react';
import { useStatusToast } from '../../../lib/context/StatusToastContext';
import { hasFiles } from '../../../app/workspaceUtils';
import type { FolderId } from '../../../types/identifiers';
import type { MessageOptions } from '../../../types/documents';

type FolderKey = FolderId | 'root';

interface LoadFolderOptions {
  preserveSearch?: boolean;
}

interface SelectFolderOptions {
  replace?: boolean;
  immediate?: boolean;
}

interface FolderClickHandlers {
  onSelect: (folderId: FolderKey, options?: SelectFolderOptions) => Promise<void>;
  onDrop: (event: DragEvent<HTMLElement>, folderId: FolderKey) => Promise<void>;
  onDragOver: (event: DragEvent<HTMLElement>, folderId: FolderKey) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
}

import useNotifyApiError from '../../../hooks/useNotifyApiError';

import type {
  FolderState,
  DragState,
} from '../../types/workspaceTypes';

import type FoldersManager from '../../FoldersManager';

interface UseFolderTreeActionsOptions {
  folderState: Pick<FolderState, 'folderNodes' | 'selectedFolder' | 'setSelectedFolder' | 'setCreatingFolder'> & { foldersManager: FoldersManager };
  dragState: DragState;
  actions: {
    handleFileDrop: (dataTransfer: DataTransfer, folderId: FolderKey) => Promise<void> | void;
    moveDocumentsToFolder: (docIds: FolderId[], folderId: FolderKey) => Promise<void>;
  };
  utils: {
    isInvalidFolderDrop: (sourceFolderId: FolderKey, targetFolderId: FolderKey) => boolean;
  };
}

const useFolderTreeActions = ({
  folderState,
  dragState,
  actions,
  utils,
}: UseFolderTreeActionsOptions) => {
  const {
    folderNodes,
    selectedFolder,
    setSelectedFolder,
    setCreatingFolder,
    foldersManager,
  } = folderState;

  const {
    draggedDocumentIds,
    draggedFolderId,
    setDraggedDocumentIds,
    setDraggedFolderId,
  } = dragState;

  const {
    handleFileDrop,
    moveDocumentsToFolder,
  } = actions;

  const { isInvalidFolderDrop } = utils;
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();
  const navigate = useNavigate();

  const moveFolder = useCallback(
    async (folderId: FolderKey, targetFolderId: FolderKey | null) => {
      const node = folderNodes.get(folderId);
      if (!node) {
        showToast('Folder metadata unavailable. Try refreshing.', 'error');
        return;
      }

      const previousParentKey = node.parentId ?? 'root';
      const targetKey = targetFolderId && targetFolderId !== 'root' ? targetFolderId : 'root';

      if (previousParentKey === targetKey) {
        return;
      }

      try {
        await foldersManager.move(folderId, targetKey);

        if (selectedFolder === folderId) {
          setSelectedFolder(folderId);
        }

        showToast('Folder moved.', 'success');
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to move folder.';
        notifyApiError(error, message);
      }
    },
    [
      folderNodes,
      notifyApiError,
      selectedFolder,
      foldersManager,
      setSelectedFolder,
      showToast,
    ],
  );

  const loadFolder = useCallback(
    async (folderId: FolderKey | null, { preserveSearch: _preserveSearch = false }: LoadFolderOptions = {}) => {
      const targetId = folderId || 'root';
      setSelectedFolder(targetId);
    },
    [setSelectedFolder],
  );

  const selectFolder = useCallback(
    async (folderId: FolderKey | null, { replace = false, immediate = false }: SelectFolderOptions = {}) => {
      const targetId = folderId && folderId !== 'root' ? folderId : 'root';

      if (!navigate || immediate) {
        await loadFolder(targetId);
        return;
      }

      let path: string;
      if (targetId === 'root') {
        path = '/folders';
      } else if (targetId === 'trash') {
        path = '/trash';
      } else {
        path = `/folders/${targetId}`;
      }
      navigate(path, { replace });
    },
    [
      loadFolder,
      navigate,
    ],
  );

  const handleFolderRename = useCallback(
    async (folderId: FolderKey, nextName: string) => {
      const trimmed = nextName?.trim?.() || '';
      if (!trimmed) {
        showToast('Folder name cannot be empty.', 'error');
        return false;
      }
      try {
        await foldersManager.rename(folderId, trimmed);

        showToast('Folder renamed.', 'success');
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to rename folder.';
        notifyApiError(error, message);
        return false;
      }
    },
    [
      notifyApiError,
      foldersManager,
      showToast,
    ],
  );

  const handleFolderCreate = useCallback(
    async (name: string, parentId?: FolderKey | null) => {
      if (!name.trim()) {
        showToast('Folder name cannot be empty.', 'error');
        return false;
      }

      const targetParentId = parentId !== undefined
        ? (parentId === 'root' ? null : parentId)
        : (selectedFolder === 'root' ? null : selectedFolder);

      setCreatingFolder(true);
      let succeeded = false;
      try {
        await foldersManager.create(name.trim(), targetParentId);

        showToast('Folder created.', 'success');

        succeeded = true;
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to create folder.';
        notifyApiError(error, message);
        return false;
      } finally {
        setCreatingFolder(false);
        if (!succeeded) {
          showToast('Folder creation failed.', 'error');
        }
      }
    },
    [
      notifyApiError,
      selectedFolder,
      setCreatingFolder,
      foldersManager,
      showToast,
    ],
  );

  const handleFolderDelete = useCallback(
    async (folderId: FolderKey, { showMessage = true }: MessageOptions = {}) => {
      if (!folderId || folderId === 'root') {
        if (showMessage) {
          showToast('The root folder cannot be removed.', 'error');
        }
        return false;
      }

      try {
        await foldersManager.delete(folderId);

        if (selectedFolder === folderId) {
          // Fallback selection logic
          const node = folderNodes.get(folderId);
          const parentId = node?.parentId || 'root';
          setSelectedFolder(parentId);
        }

        if (showMessage) {
          showToast('Folder deleted.', 'success');
        }
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to delete folder.';
        notifyApiError(error, message);
        if (showMessage) {
          showToast(message, 'error');
        }
        return false;
      }
    },
    [
      folderNodes,
      notifyApiError,
      selectedFolder,
      foldersManager,
      setSelectedFolder,
      showToast,
    ],
  );

  const folderClickHandlers: FolderClickHandlers = useMemo(
    () => ({
      onSelect: selectFolder,
      onDrop: async (event: DragEvent<HTMLElement>, folderId: FolderKey) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('is-drop-target');

        let folderIds: FolderId[] = [];
        try {
          const rawFolderList = event.dataTransfer.getData('application/x-papercrate-folder-list');
          if (rawFolderList) {
            const parsed = JSON.parse(rawFolderList);
            if (Array.isArray(parsed)) {
              folderIds = parsed.filter(Boolean);
            }
          }
        } catch (error) {
          console.warn('[folders] Failed to parse folder list drag payload', error);
        }

        if (!folderIds.length) {
          let folderSourceId = draggedFolderId;
          if (!folderSourceId) {
            try {
              if (event.dataTransfer.types?.includes('application/x-papercrate-folder')) {
                folderSourceId = event.dataTransfer.getData('application/x-papercrate-folder');
              }
            } catch (error) {
              console.warn('[folders] Failed to read folder id from drag payload', error);
            }
          }

          if (folderSourceId) {
            folderIds = [folderSourceId];
          }
        }

        folderIds = Array.from(new Set(folderIds.filter(Boolean)));

        if (folderIds.length) {
          setDraggedFolderId(null);
          const invalidMove = folderIds.some((sourceId) => isInvalidFolderDrop(sourceId, folderId));
          if (invalidMove) {
            showToast(
              'Cannot move a folder into itself or one of its descendants.',
              'error',
            );
            return;
          }

          for (const sourceId of folderIds) {
            await moveFolder(sourceId, folderId);
          }
        }

        if (hasFiles(event)) {
          await handleFileDrop(event.dataTransfer, folderId);
          return;
        }

        let docIds: FolderId[] = [];
        try {
          const raw = event.dataTransfer.getData('application/x-papercrate-doc-list');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              docIds = parsed.filter(Boolean);
            }
          }
        } catch (error) {
          console.warn('[documents] Failed to parse document list drag payload', error);
        }

        if (!docIds.length) {
          try {
            const single = event.dataTransfer.getData('application/x-papercrate-doc');
            if (single) {
              docIds = [single];
            }
          } catch (error) {
            console.warn('[documents] Failed to read single document drag payload', error);
          }
        }

        if (!docIds.length && draggedDocumentIds.length) {
          docIds = draggedDocumentIds;
        }

        docIds = Array.from(new Set(docIds));

        if (!docIds.length || folderId === selectedFolder) {
          return;
        }

        setDraggedDocumentIds([]);
        await moveDocumentsToFolder(docIds, folderId);
      },
      onDragOver: (event: DragEvent<HTMLElement>, folderId: FolderKey) => {
        const folderDragActive = Boolean(draggedFolderId);
        if (folderDragActive && isInvalidFolderDrop(draggedFolderId, folderId)) {
          return;
        }

        if (hasFiles(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          event.currentTarget.classList.add('is-drop-target');
          return;
        }

        if (draggedDocumentIds.length || folderDragActive) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          event.currentTarget.classList.add('is-drop-target');
        }
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        event.currentTarget.classList.remove('is-drop-target');
      },
    }),
    [
      draggedDocumentIds,
      draggedFolderId,
      handleFileDrop,
      isInvalidFolderDrop,
      moveDocumentsToFolder,
      moveFolder,
      selectFolder,
      selectedFolder,
      setDraggedDocumentIds,
      setDraggedFolderId,
      showToast,
    ],
  );

  return {
    loadFolder,
    selectFolder,
    handleFolderRename,
    handleFolderCreate,
    handleFolderDelete,
    folderClickHandlers,
  };
};

export default useFolderTreeActions;
