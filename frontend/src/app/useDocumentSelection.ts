import { useCallback, useRef, useState } from 'react';
import {
  createDocumentEntryKey,
  createFolderEntryKey,
  isDocumentEntry,
  isFolderEntry,
  getEntryId,
} from './entryKey';
import type { DocumentId } from '../types/identifiers';

interface SelectionEventLike {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  preventDefault?: () => void;
}

interface UseDocumentSelectionOptions {
  initialEntries?: string[];
}

interface ApplySelectionOptions {
  anchor: string | null;
  interactedKeys?: string[];
}

const DEFAULT_INITIAL_ENTRIES: string[] = [];

export const useDocumentSelection = ({
  initialEntries = DEFAULT_INITIAL_ENTRIES,
}: UseDocumentSelectionOptions = {}) => {
  const [selectedEntries, setSelectedEntries] = useState<string[]>(initialEntries);
  const [selectionOrder, setSelectionOrder] = useState<string[]>(initialEntries);
  const selectionOrderRef = useRef<string[]>(initialEntries);
  const selectionAnchorRef = useRef<string | null>(null);
  const selectionInitializedRef = useRef(false);
  const [focusedDocumentId, setFocusedDocumentId] = useState<DocumentId | null>(null);
  const [focusedEntryKey, setFocusedEntryKey] = useState<string | null>(null);

  const visibleEntryKeySetRef = useRef<Set<string>>(new Set());
  const navigableEntryKeysRef = useRef<string[]>([]);

  const configureSelectionEnvironment = useCallback(({
    visibleEntryKeySet,
    navigableEntryKeys,
  }: {
    visibleEntryKeySet?: Set<string>;
    navigableEntryKeys?: string[];
  }) => {
    if (visibleEntryKeySet) {
      visibleEntryKeySetRef.current = visibleEntryKeySet;
    }
    if (Array.isArray(navigableEntryKeys)) {
      navigableEntryKeysRef.current = navigableEntryKeys;
    }
  }, []);

  const updateSelectionOrder = useCallback((nextSelection: string[], interactedKeys: string[] = []) => {
    const nextSet = new Set(nextSelection);
    const previousOrder = selectionOrderRef.current.filter((id) => nextSet.has(id));
    const interacted = (interactedKeys || []).filter((id, index, array) => array.indexOf(id) === index);

    const base = previousOrder.filter((id) => !interacted.includes(id));
    const result = [...base];

    interacted.forEach((id) => {
      if (nextSet.has(id) && !result.includes(id)) {
        result.push(id);
      }
    });

    nextSelection.forEach((id) => {
      if (!result.includes(id)) {
        result.push(id);
      }
    });

    if (
      result.length !== selectionOrderRef.current.length
      || result.some((id, index) => selectionOrderRef.current[index] !== id)
    ) {
      selectionOrderRef.current = result;
      setSelectionOrder(result);
    } else {
      selectionOrderRef.current = result;
    }
  }, []);

  const applySelection = useCallback(
    (
      entryKeys: Array<string | null>,
      { anchor = null, interactedKeys = [] }: ApplySelectionOptions = { anchor: null, interactedKeys: [] },
    ) => {
      const visibleEntryKeySet = visibleEntryKeySetRef.current;
      const unique: string[] = [];

      (entryKeys || []).forEach((key) => {
        if (!key) return;
        let canonicalKey: string | null = null;
        if (visibleEntryKeySet.has(key)) {
          canonicalKey = key;
        } else if (isDocumentEntry(key)) {
          const id = getEntryId(key);
          canonicalKey = id ? createDocumentEntryKey(id) : null;
        } else if (isFolderEntry(key)) {
          const id = getEntryId(key);
          canonicalKey = id ? createFolderEntryKey(id) : null;
        }

        if (!canonicalKey || !visibleEntryKeySet.has(canonicalKey)) {
          return;
        }

        if (!unique.includes(canonicalKey)) {
          unique.push(canonicalKey);
        }
      });

      let resolvedAnchor: string | null = anchor ?? null;
      if (resolvedAnchor && !unique.includes(resolvedAnchor)) {
        resolvedAnchor = null;
      }

      setSelectedEntries(unique);
      updateSelectionOrder(unique, interactedKeys);

      const nextFocusedDocumentId: DocumentId | null = (() => {
        if (focusedDocumentId) {
          const focusKey = createDocumentEntryKey(focusedDocumentId);
          if (focusKey && unique.includes(focusKey)) {
            return focusedDocumentId;
          }
        }

        if (resolvedAnchor && isDocumentEntry(resolvedAnchor)) {
          return getEntryId(resolvedAnchor) ?? null;
        }

        const lastDocKey = [...unique].reverse().find((key) => isDocumentEntry(key)) ?? null;
        return lastDocKey ? getEntryId(lastDocKey) ?? null : null;
      })();

      setFocusedDocumentId(nextFocusedDocumentId);

      if (resolvedAnchor) {
        selectionAnchorRef.current = resolvedAnchor;
      } else if (!unique.length) {
        selectionAnchorRef.current = null;
      } else if (!selectionAnchorRef.current || !unique.includes(selectionAnchorRef.current)) {
        selectionAnchorRef.current = unique[unique.length - 1];
      }

      return { selection: unique, focusKey: selectionAnchorRef.current };
    },
    [
      focusedDocumentId,
      updateSelectionOrder,
    ],
  );

  const clearSelection = useCallback(() => {
    setFocusedEntryKey(null);
    applySelection([], { anchor: null, interactedKeys: [] });
  }, [applySelection]);

  const handleEntrySelection = useCallback(
    (entryKeyOrKeys: string | string[], event?: SelectionEventLike) => {
      const visibleEntryKeySet = visibleEntryKeySetRef.current;
      const navigableEntryKeys = navigableEntryKeysRef.current;

      const entryKeys = Array.isArray(entryKeyOrKeys) ? entryKeyOrKeys : [entryKeyOrKeys];
      const validKeys = entryKeys.filter((key) => key && visibleEntryKeySet.has(key));

      if (validKeys.length === 0) {
        return;
      }

      // Focus the last valid key
      const lastKey = validKeys[validKeys.length - 1];
      setFocusedEntryKey(lastKey);

      const shiftKey = Boolean(event?.shiftKey);
      const metaKey = Boolean(event?.metaKey);
      const ctrlKey = Boolean(event?.ctrlKey);
      const additive = metaKey || ctrlKey;

      if (shiftKey) {
        event?.preventDefault?.();
      }

      let anchorKey = selectionAnchorRef.current;
      if (!anchorKey && shiftKey && selectedEntries.length) {
        anchorKey = selectedEntries[selectedEntries.length - 1];
      }
      if (!anchorKey) {
        anchorKey = lastKey;
      }

      let nextKeys: string[] = [];
      let interactedKeys: string[] = [];

      // Shift selection logic (range) - primarily for single click + shift
      if (shiftKey && anchorKey && validKeys.length === 1) {
        const entryKey = validKeys[0];
        const anchorIndex = navigableEntryKeys.indexOf(anchorKey);
        const targetIndex = navigableEntryKeys.indexOf(entryKey);
        if (anchorIndex !== -1 && targetIndex !== -1) {
          const [start, end] = anchorIndex <= targetIndex
            ? [anchorIndex, targetIndex]
            : [targetIndex, anchorIndex];
          const range = navigableEntryKeys.slice(start, end + 1);
          nextKeys = range;

          const previousSet = new Set(selectedEntries);
          interactedKeys = range.filter((key) => key === entryKey || !previousSet.has(key));
          if (!interactedKeys.includes(entryKey)) {
            interactedKeys.push(entryKey);
          }
        } else {
          nextKeys = [entryKey];
          interactedKeys = [entryKey];
        }
      } else if (additive) {
        // Additive batch
        const previousSet = new Set(selectedEntries);
        if (validKeys.length === 1) {
          const entryKey = validKeys[0];
          if (previousSet.has(entryKey)) {
            nextKeys = selectedEntries.filter((key) => key !== entryKey);
            interactedKeys = [];
          } else {
            nextKeys = [...selectedEntries, entryKey];
            interactedKeys = [entryKey];
          }
        } else {
          // Batch add
          validKeys.forEach(key => previousSet.add(key));
          nextKeys = Array.from(previousSet) as string[];
          interactedKeys = validKeys;
        }
        anchorKey = lastKey;
      } else {
        // Replace with batch
        nextKeys = validKeys;
        interactedKeys = validKeys;
        anchorKey = lastKey;
      }

      applySelection(nextKeys, { anchor: anchorKey, interactedKeys });
    },
    [applySelection, selectedEntries],
  );

  const promoteSelectionOrder = useCallback(
    (docId?: DocumentId | null) => {
      if (!docId) return;
      const entryKey = createDocumentEntryKey(docId);
      if (!entryKey) return;

      if (!selectedEntries.includes(entryKey)) {
        return;
      }

      updateSelectionOrder(selectedEntries, [entryKey]);
    },
    [selectedEntries, updateSelectionOrder],
  );

  return {
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
  };
};
