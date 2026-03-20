import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createDocumentEntryKey, createFolderEntryKey, isFolderEntry } from '../../../app/entryKey';
import type { DocumentId, FolderId } from '../../../types/identifiers';

interface FolderEntry {
  id: FolderId;
  [key: string]: unknown;
}

interface DocumentEntry {
  id: DocumentId;
  [key: string]: unknown;
}

interface NavigableRow {
  key: string;
  type: 'folder' | 'document';
  id: FolderId | DocumentId;
}

interface UseDocumentsSelectionOptions {
  showingSearchResults?: boolean;
  currentSubfolders?: FolderEntry[];
  visibleDocuments?: DocumentEntry[];
  configureSelectionEnvironment: (config: { visibleEntryKeySet: Set<string>; navigableEntryKeys: string[] }) => void;
  visibleEntryKeySet: Set<string>;
  selectedEntries: string[];
  selectionAnchorRef: { current: string | null };
  promoteSelectionOrderRaw: (id: DocumentId) => void;
  setFocusedDocumentId: (id: DocumentId | null) => void;
  setActiveViewerId: (id: DocumentId | null) => void;
  clearSelection: () => void;
  focusedDocumentId: DocumentId | null;
  setFocusedEntryKey: Dispatch<SetStateAction<string | null>>;
  focusedEntryKey: string | null;
}

const useDocumentsSelection = ({
  showingSearchResults,
  currentSubfolders = [],
  visibleDocuments = [],
  configureSelectionEnvironment,
  visibleEntryKeySet,
  selectedEntries,
  selectionAnchorRef,
  promoteSelectionOrderRaw,
  setFocusedDocumentId,
  setActiveViewerId,
  clearSelection,
  focusedDocumentId,
  setFocusedEntryKey,
  focusedEntryKey,
}: UseDocumentsSelectionOptions) => {
  const navigableRows = useMemo<NavigableRow[]>(() => {
    const entries: NavigableRow[] = [];
    if (!showingSearchResults) {
      currentSubfolders.forEach((folder) => {
        const key = createFolderEntryKey(folder.id);
        if (key) {
          entries.push({ key, type: 'folder', id: folder.id });
        }
      });
    }
    visibleDocuments.forEach((doc) => {
      const key = createDocumentEntryKey(doc.id);
      if (key) {
        entries.push({ key, type: 'document', id: doc.id });
      }
    });
    return entries;
  }, [showingSearchResults, currentSubfolders, visibleDocuments]);

  const navigableRowKeys = useMemo(
    () => navigableRows.map((entry) => entry.key),
    [navigableRows],
  );

  useEffect(() => {
    configureSelectionEnvironment({
      visibleEntryKeySet,
      navigableEntryKeys: navigableRowKeys,
    });
  }, [configureSelectionEnvironment, visibleEntryKeySet, navigableRowKeys]);

  const promoteSelectionOrder = useCallback(
    (docId: DocumentId | null) => {
      if (!docId) return;
      promoteSelectionOrderRaw(docId);
      const rowKey = createDocumentEntryKey(docId);
      if (rowKey) {
        selectionAnchorRef.current = rowKey;
      }
      setFocusedDocumentId(docId);
      setActiveViewerId(docId);
    },
    [promoteSelectionOrderRaw, selectionAnchorRef, setFocusedDocumentId, setActiveViewerId],
  );

  const prevFocusedDocIdRef = useRef<DocumentId | null>(focusedDocumentId);
  useEffect(() => {
    const previous = prevFocusedDocIdRef.current;
    if (previous === focusedDocumentId) {
      return;
    }
    prevFocusedDocIdRef.current = focusedDocumentId;
    if (focusedDocumentId) {
      setFocusedEntryKey(createDocumentEntryKey(focusedDocumentId));
    } else {
      setFocusedEntryKey((current) => (current && isFolderEntry(current) ? current : null));
    }
  }, [focusedDocumentId, setFocusedEntryKey]);

  useEffect(() => {
    if (!navigableRowKeys.length) {
      if (focusedEntryKey) {
        setFocusedEntryKey(null);
      }
      return;
    }

    if (focusedEntryKey && navigableRowKeys.includes(focusedEntryKey)) {
      return;
    }

    const docKey = focusedDocumentId ? createDocumentEntryKey(focusedDocumentId) : null;
    if (docKey && navigableRowKeys.includes(docKey)) {
      setFocusedEntryKey(docKey);
      return;
    }

    const selectedKey = selectedEntries.find((key) => navigableRowKeys.includes(key));
    if (selectedKey) {
      setFocusedEntryKey(selectedKey);
      return;
    }

    if (focusedEntryKey) {
      setFocusedEntryKey(null);
    }
  }, [focusedEntryKey, focusedDocumentId, navigableRowKeys, selectedEntries, setFocusedEntryKey]);

  return {
    navigableRows,
    navigableRowKeys,
    promoteSelectionOrder,
    clearDocumentSelection: clearSelection,
  };
};

export default useDocumentsSelection;
