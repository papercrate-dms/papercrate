import { useEffect, useRef } from 'react';
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
  // Track whether we've already cleared for the current search session.
  // Reset when search results disappear so the next activation clears again.
  const clearedForSearchRef = useRef(false);

  useEffect(() => {
    if (!showingSearchResults) {
      // Search ended — reset so next search entry clears selection.
      clearedForSearchRef.current = false;
      return;
    }
    if (clearedForSearchRef.current) {
      // Already cleared for this search session — don't clear on every keystroke.
      return;
    }
    clearedForSearchRef.current = true;
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
