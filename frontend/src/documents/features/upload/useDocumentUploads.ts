import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import useFileDrop from './useFileDrop';
import { useStatusToast } from '../../../lib/context/StatusToastContext';
import { DEFAULT_FOLDER_NAME, hasFiles } from '../../../app/workspaceUtils';
import { fetchDocument, uploadDocument, resolveFolderPath, listFolderContents } from '../../../lib/api/apiClient';
import type { Identifier } from '../../../types/identifiers';

type FolderId = Identifier | 'root' | null;

type FileEntry = {
  file: File;
  segments: string[];
};

type UploadStatus = 'pending' | 'uploading' | 'success' | 'duplicate' | 'error';

type UploadQueueItem = {
  id: string;
  name: string;
  size: number | null;
  folderId: FolderId;
  status: UploadStatus;
  error: string | null;
  code: number | null;
  document: unknown;
  conflictDocumentId: Identifier | null;
};

type NotifyApiError = (error: unknown, fallbackMessage?: string) => void;

type DropOverlayState = {
  active: boolean;
  folderName: string;
};

type FileSystemEntryLike = FileSystemEntry;

type ExtendedDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

interface FileSystemDirectoryReaderLike {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback: (error: DOMException) => void,
  ) => void;
}

interface FileSystemFileEntryLike extends FileSystemEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (
    successCallback: (file: File) => void,
    errorCallback: (error: DOMException) => void,
  ) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => FileSystemDirectoryReaderLike;
}
const isFileEntry = (entry: FileSystemEntryLike): entry is FileSystemFileEntryLike => {
  return entry.isFile && !entry.isDirectory;
};

const isDirectoryEntry = (entry: FileSystemEntryLike): entry is FileSystemDirectoryEntryLike => {
  return entry.isDirectory && !entry.isFile && 'createReader' in entry;
};

const mapFilesToEntries = (filesInput?: FileList | File[] | null): FileEntry[] => {
  if (!filesInput) {
    return [];
  }
  const files = Array.isArray(filesInput) ? filesInput : Array.from(filesInput);
  return files
    .filter(Boolean)
    .map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string })?.webkitRelativePath ?? '';
      const segments = relativePath
        ? relativePath
          .split('/')
          .slice(0, -1)
          .filter(Boolean)
        : [];
      return { file, segments };
    });
};

interface UseDocumentUploadsArgs {
  selectedFolder?: FolderId;
  currentFolderName?: string | null;
  refreshCurrentFolder: () => Promise<void>;
  shellRef: MutableRefObject<HTMLElement | null>;
  notifyApiError?: NotifyApiError;
}

interface UseDocumentUploadsResult {
  dropOverlayState: DropOverlayState;
  setDropOverlayState: Dispatch<SetStateAction<DropOverlayState>>;
  dragCounterRef: MutableRefObject<number>;
  handleFileDrop: (dataTransfer: DataTransfer, targetFolderId?: FolderId) => Promise<void>;
  handleFileSelection: (files?: FileList | null, targetFolderId?: FolderId) => Promise<void>;
  uploadFile: (file: File, targetFolderId: FolderId) => Promise<{
    document: unknown;
    duplicate: boolean;
    statusCode: number | null;
    conflictDocumentId: Identifier | null;
  }>;
  extractFilesFromDataTransfer: (dataTransfer: DataTransfer) => Promise<FileEntry[]>;
  resetUploadsState: () => void;
  uploadQueue: UploadQueueItem[];
  clearUploadQueue: () => void;
}

import useNotifyApiError from '../../../hooks/useNotifyApiError';

const useDocumentUploads = ({
  selectedFolder,
  currentFolderName,
  refreshCurrentFolder,
  shellRef,
}: UseDocumentUploadsArgs): UseDocumentUploadsResult => {
  const [dropOverlayState, setDropOverlayState] = useState<DropOverlayState>({
    active: false,
    folderName: currentFolderName || DEFAULT_FOLDER_NAME,
  });
  const dragCounterRef = useRef(0);
  const folderPathCacheRef = useRef<Map<string, FolderId>>(new Map());
  const queueIdRef = useRef(0);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const uploadFile = useCallback(
    async (file: File, targetFolderId: FolderId) => {
      if (!file || file.size === 0) {
        return { document: null, duplicate: false, statusCode: null, conflictDocumentId: null };
      }

      const formData = new FormData();
      formData.append('file', file, file.name);
      if (targetFolderId != null && targetFolderId !== 'root') {
        formData.append('folder_id', String(targetFolderId));
      }

      try {
        const { reused, document, status } = await uploadDocument(formData);
        const duplicate = reused || status === 200;
        return {
          document: document ?? null,
          duplicate,
          statusCode: status ?? (duplicate ? 200 : 201),
          conflictDocumentId: null,
        };
      } catch (error: any) {
        if (error.response?.status === 409) {
          const conflictId = error.response?.data?.details?.conflict_document_id ?? null;
          let conflictDocument = null;
          if (conflictId) {
            try {
              conflictDocument = await fetchDocument(conflictId);
            } catch (fetchError) {
              console.warn('[Uploads] failed to fetch conflict document', fetchError);
            }
          }
          return {
            document: conflictDocument,
            duplicate: true,
            statusCode: 409,
            conflictDocumentId: conflictId,
          };
        }
        const message = error.response?.data?.error || `Failed to upload ${file.name}.`;
        notifyApiError?.(error, message);
        showToast(message, 'error');
        const wrapped = Object.assign(new Error(message), { response: error.response });
        throw wrapped;
      }
    },
    [notifyApiError, showToast],
  );

  const appendQueueItems = useCallback((entries: FileEntry[], targetFolderId?: FolderId) => {
    const baseId = Date.now();
    const items = entries.map(({ file }) => {
      queueIdRef.current += 1;
      return {
        id: `upload-${baseId}-${queueIdRef.current}`,
        name: file?.name || 'Unnamed file',
        size: file?.size ?? null,
        folderId: targetFolderId ?? selectedFolder ?? 'root',
        status: 'pending' as UploadStatus,
        error: null,
        code: null,
        document: null,
        conflictDocumentId: null,
      } satisfies UploadQueueItem;
    });
    if (items.length) {
      setUploadQueue((current) => [...current, ...items]);
    }
    return items;
  }, [selectedFolder]);

  const updateQueueItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    if (!id) {
      return;
    }
    setUploadQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const ensureFolderPathOnServer = useCallback(
    async (baseFolderId: FolderId, segments: string[]): Promise<FolderId> => {
      const trimmedSegments = segments.map((segment) => segment.trim()).filter(Boolean);
      if (trimmedSegments.length === 0) {
        return baseFolderId ?? null;
      }

      const cacheKey = `${baseFolderId ?? 'ROOT'}:${trimmedSegments.join('/')}`;
      const cache = folderPathCacheRef.current;
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey) ?? null;
      }

      const payload = {
        parent_id: baseFolderId && baseFolderId !== 'root' ? baseFolderId : null,
        segments: trimmedSegments,
      };

      const { folder } = await resolveFolderPath(payload);
      const resolvedId = (folder?.id ?? null) as FolderId;
      cache.set(cacheKey, resolvedId);
      return resolvedId;
    },
    [],
  );

  const extractFilesFromDataTransfer = useCallback(async (dataTransfer: DataTransfer) => {
    if (!dataTransfer) {
      throw new Error('No drop payload found.');
    }

    const items = Array.from(dataTransfer.items || []) as ExtendedDataTransferItem[];
    console.info('[Uploads] drop start', {
      items: items.length,
      files: (dataTransfer.files || []).length,
    });

    const results: FileEntry[] = [];
    const seenKeys = new Set();

    const pushFile = (file?: File | null, ancestors: string[] = []) => {
      if (!file) return;
      const segments = (ancestors || []).filter(Boolean);
      const key = `${segments.join('/')}/${file.name}:${file.size}`;
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      results.push({ file, segments });
    };

    const readAllEntries = async (reader: FileSystemDirectoryReaderLike) => {
      const entries: FileSystemEntryLike[] = [];
      let batch: FileSystemEntryLike[] = [];
      do {
        batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length) {
          entries.push(...batch);
        }
      } while (batch.length);
      return entries;
    };

    const walkEntry = async (entry: FileSystemEntryLike | null, ancestors: string[] = []) => {
      if (!entry) return;
      if (isFileEntry(entry)) {
        const file = await new Promise<File>((resolve, reject) => {
          try {
            entry.file(resolve, reject);
          } catch (error) {
            console.warn('[Uploads] entry.file failed', error);
            reject(error as Error);
          }
        });
        pushFile(file, ancestors);
        return;
      }
      if (isDirectoryEntry(entry)) {
        const nextAncestors = entry.name ? [...ancestors, entry.name] : [...ancestors];
        const reader = entry.createReader();
        const entries = await readAllEntries(reader);
        for (const child of entries) {
          await walkEntry(child, nextAncestors);
        }
      }
    };

    await Promise.all(
      items.map(async (item, index) => {
        if (item.kind !== 'file') return;

        const fileFromItem = item.getAsFile?.() ?? null;
        if (fileFromItem) {
          const relativePath = (fileFromItem as File & { webkitRelativePath?: string })?.webkitRelativePath ?? '';
          const segments = relativePath
            ? relativePath
              .split('/')
              .slice(0, -1)
              .filter(Boolean)
            : [];
          pushFile(fileFromItem, segments);
        }

        if ((item as ExtendedDataTransferItem).webkitGetAsEntry) {
          try {
            const entry = (item as ExtendedDataTransferItem).webkitGetAsEntry?.();
            if (entry) {
              await walkEntry(entry, []);
              return;
            }
          } catch (error) {
            console.warn('[Uploads] webkitGetAsEntry failed', error);
          }
        }

        if (!fileFromItem) {
          console.info('[Uploads] item missing file handle', index);
        }
      }),
    );

    Array.from(dataTransfer.files || []).forEach((file) => {
      if (!file) return;
      const relativePath = (file as File & { webkitRelativePath?: string })?.webkitRelativePath ?? '';
      const segments = relativePath
        ? relativePath
          .split('/')
          .slice(0, -1)
          .filter(Boolean)
        : [];
      pushFile(file, segments);
    });

    if (!results.length) {
      throw new Error('No files detected in drop payload.');
    }

    console.info('[Uploads] prepared files', results.length);

    return results;
  }, []);

  const uploadFileEntries = useCallback(
    async (entries, targetFolderId) => {
      if (!entries || !entries.length) {
        console.warn('[Uploads] No files to upload.');
        return;
      }

      const queueItems = appendQueueItems(entries, targetFolderId);

      try {
        folderPathCacheRef.current.clear();

        const baseFolderId =
          targetFolderId && targetFolderId !== 'root' ? targetFolderId : null;

        for (let index = 0; index < entries.length; index += 1) {
          const { file, segments } = entries[index];
          const queueItem = queueItems[index];
          if (queueItem) {
            const patch = { status: 'uploading', error: null, code: null };
            updateQueueItem(queueItem.id, patch);
            Object.assign(queueItem, patch);
          }
          const destinationId = segments.length
            ? await ensureFolderPathOnServer(baseFolderId, segments)
            : baseFolderId;

          const uploadTarget =
            destinationId ??
            (targetFolderId && targetFolderId !== 'root' ? targetFolderId : 'root');

          try {
            const { duplicate, statusCode, document, conflictDocumentId } = await uploadFile(
              file,
              uploadTarget,
            );
            if (queueItem) {
              const patch = {
                status: duplicate ? 'duplicate' : 'success',
                code: statusCode ?? null,
                document: document || queueItem.document,
                conflictDocumentId: conflictDocumentId ?? queueItem.conflictDocumentId,
              };
              updateQueueItem(queueItem.id, patch);
              Object.assign(queueItem, patch);
            }
          } catch (error: any) {
            if (queueItem) {
              const patch = {
                status: 'error',
                error: error.response?.data?.error || error.message || 'Upload failed.',
                code: error.response?.status ?? null,
              };
              updateQueueItem(queueItem.id, patch);
              Object.assign(queueItem, patch);
            }
            continue;
          }
        }

        await refreshCurrentFolder();

        if (
          targetFolderId &&
          targetFolderId !== 'root' &&
          targetFolderId !== selectedFolder
        ) {
          await listFolderContents(targetFolderId);
        }
      } catch (error: any) {
        const message = error.message || 'Failed to upload files.';
        queueItems.forEach((item) => {
          if (item.status === 'success' || item.status === 'duplicate' || item.status === 'error') {
            return;
          }
          const patch = {
            status: 'error',
            error: message,
            code: error.response?.status ?? null,
          };
          updateQueueItem(item.id, patch);
          Object.assign(item, patch);
        });
        console.error('[Uploads] batch failed', error);
      }
    },
    [
      ensureFolderPathOnServer,
      uploadFile,
      refreshCurrentFolder,
      selectedFolder,
      appendQueueItems,
      updateQueueItem,
    ],
  );

  const handleFileDrop = useCallback(
    async (dataTransfer: DataTransfer, targetFolderId?: FolderId) => {
      let extracted: FileEntry[];
      try {
        extracted = await extractFilesFromDataTransfer(dataTransfer);
      } catch (error) {
        console.error('[Uploads] Failed to process dropped files.', error);
        return;
      }

      await uploadFileEntries(extracted, targetFolderId);
    },
    [extractFilesFromDataTransfer, uploadFileEntries],
  );

  const handleFileSelection = useCallback(
    async (files?: FileList | null, targetFolderId?: FolderId) => {
      const entries = mapFilesToEntries(files);
      await uploadFileEntries(entries, targetFolderId);
    },
    [uploadFileEntries],
  );

  useFileDrop({
    shellRef,
    currentFolderName,
    selectedFolder,
    handleFileDrop,
    hasFiles,
    defaultFolderName: DEFAULT_FOLDER_NAME,
    dragCounterRef,
    setDropOverlayState,
  });

  const resetUploadsState = useCallback(() => {
    dragCounterRef.current = 0;
    setDropOverlayState({ active: false, folderName: DEFAULT_FOLDER_NAME });
    setUploadQueue([]);
  }, []);

  const clearUploadQueue = useCallback(() => {
    setUploadQueue([]);
  }, []);

  return {
    dropOverlayState,
    setDropOverlayState,
    dragCounterRef,
    handleFileDrop,
    handleFileSelection,
    uploadFile,
    extractFilesFromDataTransfer,
    resetUploadsState,
    uploadQueue,
    clearUploadQueue,
  } satisfies UseDocumentUploadsResult;
};

export default useDocumentUploads;
