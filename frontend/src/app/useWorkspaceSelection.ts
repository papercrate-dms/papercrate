import { useCallback, useMemo } from 'react';
import { useDocumentSelection } from './useDocumentSelection';
import { isDocumentEntry, isFolderEntry, getEntryId } from './entryKey';

interface SelectionEntry {
  entryKey?: string;
  // Legacy field for compatibility
  // rowKey?: string; // Removed as part of refactor
  [key: string]: unknown;
}

interface WorkspaceSelectionOptions {
  onDocumentActivate?: (id: string) => void;
  onInspectFolder?: (id: string) => void;
}

const identity = <T,>(value: T) => value;

export const useWorkspaceSelection = ({
  onDocumentActivate = identity,
  onInspectFolder = identity,
}: WorkspaceSelectionOptions = {}) => {
  const selection = useDocumentSelection();

  const {
    selectedEntries,
    setSelectedEntries,
    selectionOrder,
    setSelectionOrder,
    selectionOrderRef,
    selectionAnchorRef,
    selectionInitializedRef,
    focusedDocumentId,
    setFocusedDocumentId,
    focusedEntryKey,
    setFocusedEntryKey,
    applySelection,
    clearSelection,
    handleEntrySelection,
    promoteSelectionOrder,
    configureSelectionEnvironment,
  } = selection;

  const selectedDocumentIds = useMemo(
    () =>
      selectedEntries
        .filter((entry) => isDocumentEntry(entry))
        .map((entry) => getEntryId(entry))
        .filter(Boolean),
    [selectedEntries],
  );

  const selectedFolderIds = useMemo(
    () =>
      selectedEntries
        .filter((entry) => isFolderEntry(entry))
        .map((entry) => getEntryId(entry))
        .filter(Boolean),
    [selectedEntries],
  );

  const selectEntry = useCallback(
    (entryOrEntries: SelectionEntry | string | Array<SelectionEntry | string>, event?: unknown) => {
      const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
      const entryKeys = entries
        .map((entry) => {
          return entry && Object(entry) === entry
            ? (entry as SelectionEntry).entryKey ?? undefined
            : (entry as string);
        })
        .filter((key): key is string => Boolean(key));

      if (entryKeys.length === 0) return;
      handleEntrySelection(entryKeys, event);
    },
    [handleEntrySelection],
  );

  const inspectDocument = useCallback(
    (documentId?: string) => {
      if (!documentId) return;
      onDocumentActivate(documentId);
    },
    [onDocumentActivate],
  );

  const inspectFolder = useCallback(
    (folderId?: string) => {
      if (!folderId) return;
      onInspectFolder(folderId);
    },
    [onInspectFolder],
  );

  return {
    selectedEntries,
    selectedDocumentIds,
    selectedFolderIds,
    selectionOrder,
    selectionOrderRef,
    selectionAnchorRef,
    selectionInitializedRef,
    focusedDocumentId,
    setFocusedDocumentId,
    focusedEntryKey,
    setFocusedEntryKey,
    applySelection,
    clearSelection,
    handleEntrySelection: selectEntry,
    promoteSelectionOrder,
    configureSelectionEnvironment,
    setSelectedEntries,
    setSelectionOrder,
    inspectDocument,
    inspectFolder,
  };
};
