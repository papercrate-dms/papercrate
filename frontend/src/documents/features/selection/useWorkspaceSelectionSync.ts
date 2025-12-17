import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { Identifier } from '../../../types/identifiers';

interface UseWorkspaceSelectionSyncArgs {
  showingSearchResults: boolean;
  searchQuery: string;
  setSelectedEntries: (entries: Array<string>) => void;
  setSelectionOrder: (order: Array<string>) => void;
  selectionOrderRef: MutableRefObject<Array<string>>;
  selectionAnchorRef: MutableRefObject<Identifier | string | null>;
  setFocusedDocumentId: (id: Identifier | null) => void;
  selectedDocumentIds: Identifier[];
  activeViewerId: Identifier | null;
  setActiveViewerId: (id: Identifier | null) => void;
  selectionInitializedRef: MutableRefObject<boolean>;
}

const useWorkspaceSelectionSync = ({
  showingSearchResults,
  searchQuery,
  setSelectedEntries,
  setSelectionOrder,
  selectionOrderRef,
  selectionAnchorRef,
  setFocusedDocumentId,
  selectedDocumentIds,
  activeViewerId,
  setActiveViewerId,
  selectionInitializedRef,
}: UseWorkspaceSelectionSyncArgs) => {
  useEffect(() => {
    if (!showingSearchResults) {
      return;
    }
    setSelectedEntries([]);
    setSelectionOrder([]);
    selectionOrderRef.current = [];
    selectionAnchorRef.current = null;
    setFocusedDocumentId(null);
  }, [
    showingSearchResults,
    searchQuery,
    setSelectedEntries,
    setSelectionOrder,
    selectionOrderRef,
    selectionAnchorRef,
    setFocusedDocumentId,
  ]);

  useEffect(() => {
    if (!selectedDocumentIds.length) {
      return;
    }
    if (!selectedDocumentIds.includes(activeViewerId as Identifier)) {
      setActiveViewerId(selectedDocumentIds[selectedDocumentIds.length - 1]);
    }
    selectionInitializedRef.current = true;
  }, [selectedDocumentIds, activeViewerId, selectionInitializedRef, setActiveViewerId]);
};

export default useWorkspaceSelectionSync;
