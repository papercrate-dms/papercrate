import { useCallback } from 'react';
import { createDocumentEntryKey, createFolderEntryKey } from '../../../app/entryKey';

type PointerEventLike = MouseEvent | PointerEvent;

export const isPointerModifierEvent = (event?: PointerEventLike | null): boolean =>
  Boolean(event && (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey));

export const isPrimaryPointerEvent = (event?: PointerEventLike | null): boolean => {
  if (!event) {
    return true;
  }
  if (event.button !== 0) {
    return false;
  }
  const type = event?.type?.toLowerCase?.() ?? '';
  return type === 'click' || type === 'pointerdown' || type === 'pointerup';
};

type EntryType = 'document' | 'folder';

interface WorkspaceEntry {
  id: string;
  key?: string;
  type: EntryType;
  [key: string]: unknown;
}

interface UseEntryPointerOptions {
  onSelectEntry?: (entry: WorkspaceEntry, event?: PointerEventLike | null, metadata?: EntryPointerMetadata) => void;
  onDocumentActivate?: (id: string, metadata?: EntryPointerMetadata) => void;
}

interface EntryPointerMetadata {
  modifierClick: boolean;
  primaryClick: boolean;
  rowKey: string;
  type: EntryType;
  id: string;
}

export const useEntryPointer = ({
  onSelectEntry,
  onDocumentActivate,
}: UseEntryPointerOptions) =>
  useCallback(
    (entry?: WorkspaceEntry | null, event?: PointerEventLike | null) => {
      if (!entry || !entry.id) {
        return;
      }

      const { type, id } = entry;
      if (type !== 'document' && type !== 'folder') {
        return;
      }

      const rowKey = entry.key
        || (type === 'document' ? createDocumentEntryKey(id) : createFolderEntryKey(id));
      if (!rowKey) {
        return;
      }

      const modifierClick = isPointerModifierEvent(event);
      const primaryClick = isPrimaryPointerEvent(event);
      const metadata: EntryPointerMetadata = { modifierClick, primaryClick, rowKey, type, id };

      onSelectEntry?.(entry, event, metadata);

      if (type === 'document' && !modifierClick && primaryClick) {
        onDocumentActivate?.(id, metadata);
      }
    },
    [onSelectEntry, onDocumentActivate],
  );
