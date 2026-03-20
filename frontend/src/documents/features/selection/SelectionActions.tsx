import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DEFAULT_FOLDER_NAME } from '../../../app/workspaceUtils';
import { useFolderTree } from '../../../lib/context/FolderTreeContext';
import { useTags } from '../../../lib/context/TagsContext';
import { useCorrespondents } from '../../../lib/context/CorrespondentsContext';
import { useDocumentsSearch } from '../../../lib/context/DocumentsSearchContext';
import { useDocumentsWorkspaceContext } from '../../../lib/context/DocumentsWorkspaceContext';

import {
  TrashIcon,
  AnalyzeIcon,
  IconX,
  FolderOutlineIcon,
  TagIcon,
  CorrespondentIcon,
} from '../../../components/icons';
import SelectionAssignmentMenu, { SelectionAssignmentMenuItem } from './SelectionAssignmentMenu';
import SelectionFolderMenu from './SelectionFolderMenu';
import SelectionSummary from './SelectionSummary';

import { useWorkspaceSelectionContext } from '../../../app/WorkspaceSelectionContext';
import type { DocumentId } from '../../../types/identifiers';
import type { FolderTreeNode } from '../../../lib/api/apiTypes';

type NullableDocumentId = DocumentId | null;

type SelectedIdList = NullableDocumentId[] | null;

interface TagOption {
  id?: DocumentId;
  label?: string;
  name?: string;
  color?: string | null;
}

interface CorrespondentOption {
  id?: DocumentId;
  name?: string;
  label?: string;
}

import type { Document } from '../../../types/documents';

interface BulkTagMutationArgs {
  label: string;
  input: unknown;
  documentIds: DocumentId[];
}

interface BulkCorrespondentAddArgs {
  name: string;
  input: unknown;
  documentIds: DocumentId[];
}

interface BulkCorrespondentRemoveArgs {
  assignments: Array<{ correspondent_id: DocumentId }>;
  documentIds: DocumentId[];
}

interface SelectionActionsProps {
  selectionCount?: number;
  selectedDocumentIds?: SelectedIdList;
  selectedFolderIds?: SelectedIdList;
  onClearSelection?: () => void;
}

const normalizeDocumentList = (selectedIds?: SelectedIdList): DocumentId[] =>
  Array.isArray(selectedIds)
    ? selectedIds.filter((value): value is DocumentId => value !== null && value !== undefined)
    : [];

const buildTagAssignments = (
  selectedDocuments: Document[],
  tagLookupById: Map<DocumentId, TagOption> | null,
  tags: TagOption[] | null,
  total: number,
): SelectionAssignmentMenuItem[] => {
  if (!total) {
    return [];
  }

  const map = new Map<string, {
    id?: DocumentId;
    label: string;
    color: string | null;
    count: number;
    total: number;
  }>();

  const ensureEntry = (id?: DocumentId, label?: string, color: string | null = null) => {
    const key = id ?? label;
    if (!key || !label) {
      return null;
    }
    if (!map.has(key)) {
      map.set(key, {
        id,
        label,
        color,
        count: 0,
        total,
      });
    }
    return map.get(key) ?? null;
  };

  selectedDocuments.forEach((doc) => {
    (doc?.tags || []).forEach((tagId) => {
      const tag = tagLookupById instanceof Map ? tagLookupById.get(tagId) : null;
      const lookupColor = tag?.color ?? null;
      const label = tag?.label;

      const entry = ensureEntry(tagId, label, lookupColor);
      if (entry) {
        entry.count += 1;
      }
    });
  });

  (tags || []).forEach((tag) => {
    const lookupColor = tag?.id && tagLookupById instanceof Map ? tagLookupById.get(tag.id)?.color : null;
    ensureEntry(tag?.id, tag?.label, tag?.color ?? lookupColor ?? null);
  });

  return Array.from(map.values()).map((entry) => {
    const count = entry.count || 0;
    const state = count === total ? 'all' : count > 0 ? 'partial' : 'none';
    return {
      id: entry.id ?? entry.label,
      label: entry.label,
      color: entry.color ?? null,
      count,
      total,
      state,
      payload: entry,
    };
  });
};

const buildCorrespondentAssignments = (
  selectedDocuments: Document[],
  correspondents: CorrespondentOption[] | null,
  correspondentLookupById: Map<DocumentId, CorrespondentOption> | null,
  total: number,
): SelectionAssignmentMenuItem[] => {
  if (!total) {
    return [];
  }

  const map = new Map<string, {
    id?: DocumentId;
    label: string;
    count: number;
    total: number;
  }>();

  const ensureEntry = (id?: DocumentId, name?: string) => {
    const key = id ?? name;
    if (!key || !name) {
      return null;
    }
    if (!map.has(key)) {
      map.set(key, {
        id,
        label: name,
        count: 0,
        total,
      });
    }
    return map.get(key) ?? null;
  };

  selectedDocuments.forEach((doc) => {
    (doc?.correspondents || []).forEach((correspondentId) => {
      const resolved = correspondentLookupById instanceof Map ? correspondentLookupById.get(correspondentId) : null;
      const name = resolved?.name;

      const target = ensureEntry(correspondentId, name);
      if (target) {
        target.count += 1;
      }
    });
  });

  (correspondents || []).forEach((entry) => {
    ensureEntry(entry?.id, entry?.name || entry?.label);
  });

  return Array.from(map.values()).map((entry) => {
    const count = entry.count || 0;
    const state = count === total ? 'all' : count > 0 ? 'partial' : 'none';
    return {
      id: entry.id ?? entry.label,
      label: entry.label,
      count,
      total,
      state,
      payload: entry,
    };
  });
};

const SelectionActions: React.FC<SelectionActionsProps> = ({
  selectionCount = 0,
  selectedDocumentIds = [],
  selectedFolderIds = [],
  onClearSelection = null,
}) => {
  const { tags, tagLookupById, handleBulkTagAddFromDetail: onBulkTagAdd, handleBulkTagRemoveFromDetail: onBulkTagRemove } = useTags();
  const { correspondents, correspondentLookupById, handleBulkCorrespondentAdd: onBulkCorrespondentAdd, handleBulkCorrespondentRemove: onBulkCorrespondentRemove } = useCorrespondents();
  const { documentLookup } = useDocumentsSearch();
  const { handleDeleteSelection: onDeleteSelection, handleBulkSelectionReanalyze: onBulkReanalyze } = useDocumentsWorkspaceContext();
  const { foldersManager, moveDocumentsToFolder: onMoveDocumentsToFolder } = useFolderTree();

  const documentLookupMap = useMemo(() => (
    documentLookup instanceof Map ? documentLookup : new Map<DocumentId, Document>()
  ), [documentLookup]);
  const tagLookupMap = tagLookupById instanceof Map ? tagLookupById : null;

  const [remoteFolderTree, setRemoteFolderTree] = useState<FolderTreeNode[]>([]);

  // Sync with manager
  const treeSnapshot = useSyncExternalStore(
    useCallback(cb => foldersManager.subscribe(cb), [foldersManager]),
    () => foldersManager.getTreeSnapshot(),
    () => foldersManager.getTreeSnapshot(),
  );

  const dataSnapshot = useSyncExternalStore(
    useCallback(cb => foldersManager.subscribe(cb), [foldersManager]),
    () => foldersManager.getSnapshot(),
    () => foldersManager.getSnapshot(),
  );

  useEffect(() => {
    if (!treeSnapshot || treeSnapshot.length === 0) {
      setRemoteFolderTree([]);
      return;
    }

    const map = dataSnapshot;

    const mergeNode = (node: FolderTreeNode): FolderTreeNode => {
      const liveData = map.get(node.id);
      const name = liveData?.name ?? node.name;
      const children = node.children ? node.children.map(mergeNode) : [];
      return { ...node, name, children };
    };

    const mergedTree = treeSnapshot.map(mergeNode);
    setRemoteFolderTree(mergedTree);
  }, [treeSnapshot, dataSnapshot]);

  const requestFolderTree = useCallback(() => {
    foldersManager.ensureTree();
  }, [foldersManager]);


  const handleMoveMenuOpen = useCallback(() => {
    requestFolderTree();
  }, [requestFolderTree]);

  const documentIdList = useMemo<DocumentId[]>(
    () => normalizeDocumentList(selectedDocumentIds),
    [selectedDocumentIds],
  );

  const folderIdList = useMemo<DocumentId[]>(
    () => normalizeDocumentList(selectedFolderIds),
    [selectedFolderIds],
  );

  const documentCount = documentIdList.length;
  const folderCount = folderIdList.length;
  const totalCount = selectionCount ?? documentCount + folderCount;

  const selectedDocuments = useMemo<Document[]>(() => {
    if (!documentIdList.length || !(documentLookupMap instanceof Map)) {
      return [];
    }
    return documentIdList
      .map((id) => documentLookupMap.get(id))
      .filter((doc): doc is Document => Boolean(doc));
  }, [documentIdList, documentLookupMap]);

  const selectedDocCount = selectedDocuments.length;

  const tagAssignments = useMemo(
    () => buildTagAssignments(selectedDocuments, tagLookupMap, tags, selectedDocCount),
    [selectedDocuments, tagLookupMap, tags, selectedDocCount],
  );

  const correspondentAssignments = useMemo(
    () => buildCorrespondentAssignments(selectedDocuments, correspondents, correspondentLookupById, selectedDocCount),
    [selectedDocuments, correspondents, correspondentLookupById, selectedDocCount],
  );

  const handleToggleTagAssignment = useCallback(
    async (item: SelectionAssignmentMenuItem) => {
      if (!selectedDocCount || !item) {
        return;
      }
      if (item.state === 'all') {
        await (onBulkTagRemove as any)?.({ label: item.label || '', input: null, documentIds: documentIdList });
      } else {
        await (onBulkTagAdd as any)?.({ label: item.label || '', input: null, documentIds: documentIdList });
      }
    },
    [selectedDocCount, onBulkTagAdd, onBulkTagRemove, documentIdList],
  );

  const handleCreateTagAssignment = useCallback(
    async (label: string) => {
      if (!selectedDocCount || !label) {
        return;
      }
      await (onBulkTagAdd as any)?.({ label, input: null, documentIds: documentIdList });
    },
    [selectedDocCount, onBulkTagAdd, documentIdList],
  );

  const handleToggleCorrespondentAssignment = useCallback(
    async (item: SelectionAssignmentMenuItem) => {
      if (!selectedDocCount || !item) {
        return;
      }
      if (item.state === 'all') {
        if (!item.id) {
          return;
        }
        await (onBulkCorrespondentRemove as any)?.({
          assignments: [{ correspondent_id: item.id }],
          documentIds: documentIdList,
        });
      } else {
        await (onBulkCorrespondentAdd as any)?.({ name: item.label || '', input: null, documentIds: documentIdList });
      }
    },
    [selectedDocCount, onBulkCorrespondentAdd, onBulkCorrespondentRemove, documentIdList],
  );

  const handleCreateCorrespondentAssignment = useCallback(
    async (name: string) => {
      if (!selectedDocCount || !name) {
        return;
      }
      await (onBulkCorrespondentAdd as any)?.({ name, input: null, documentIds: documentIdList });
    },
    [selectedDocCount, onBulkCorrespondentAdd, documentIdList],
  );

  const handleMoveSelectionToFolder = useCallback(
    async (folderId: DocumentId | null) => {
      const itemsToMove = [...documentIdList, ...folderIdList];
      if (!itemsToMove.length || !onMoveDocumentsToFolder) {
        return;
      }
      await onMoveDocumentsToFolder(itemsToMove, folderId);
    },
    [documentIdList, folderIdList, onMoveDocumentsToFolder],
  );

  const summaryNode = totalCount > 0 ? (
    <SelectionSummary
      documentCount={documentCount}
      folderCount={folderCount}
      totalCount={totalCount}
    />
  ) : null;

  const showPrimaryButtons = Boolean(onBulkReanalyze || onDeleteSelection || onClearSelection);

  const rootTitle = (remoteFolderTree && remoteFolderTree.length === 1)
    ? remoteFolderTree[0].name
    : DEFAULT_FOLDER_NAME;

  const moveMenu = onMoveDocumentsToFolder ? (
    <SelectionFolderMenu
      label="Move"
      triggerContent={(
        <span className="quick-add__chip-label" title="Move">
          <FolderOutlineIcon className="icon-inline" aria-hidden="true" />
          <span className="quick-add__chip-text" aria-hidden="true">Move</span>
        </span>
      )}
      folderTree={remoteFolderTree || []}
      placeholder="Search folders…"
      emptyMessage="No folders"
      onSelectFolder={handleMoveSelectionToFolder}
      disabled={!documentCount && !folderCount}
      onOpenMenu={handleMoveMenuOpen}
      rootTitle={rootTitle}
    />
  ) : null;

  return (
    <>
      {onClearSelection ? (
        <>
          <button
            type="button"
            className="icon-button selection-action"
            onClick={onClearSelection}
            aria-label="Clear selection"
            title="Clear selection"
            disabled={totalCount === 0}
          >
            <IconX className="icon-inline" />
          </button>
        </>
      ) : null}
      {summaryNode}
      <span className="selection-assignments">
        {moveMenu}
        <SelectionAssignmentMenu
          label="Tags"
          triggerContent={(
            <span className="quick-add__chip-label" title="Tags">
              <TagIcon className="icon-inline" aria-hidden="true" />
              <span className="quick-add__chip-text" aria-hidden="true">Tags</span>
            </span>
          )}
          items={tagAssignments}
          placeholder="Search tags…"
          emptyMessage="No tags"
          createLabel="Create"
          onToggle={handleToggleTagAssignment}
          onCreate={handleCreateTagAssignment}
          disabled={!documentCount}
        />
        <SelectionAssignmentMenu
          label="Correspondents"
          triggerContent={(
            <span className="quick-add__chip-label" title="Correspondents">
              <CorrespondentIcon className="icon-inline" aria-hidden="true" />
              <span className="quick-add__chip-text" aria-hidden="true">Correspondents</span>
            </span>
          )}
          items={correspondentAssignments}
          placeholder="Search correspondents…"
          emptyMessage="No correspondents"
          createLabel="Create"
          onToggle={handleToggleCorrespondentAssignment}
          onCreate={handleCreateCorrespondentAssignment}
          disabled={!documentCount}
        />
      </span>
      <span className="selection-actions-right">
        {onBulkReanalyze ? (
          <button
            type="button"
            className="icon-button selection-action"
            onClick={() => (onBulkReanalyze as any)(documentIdList)}
            aria-label="Re-run analysis for selection"
            title="Re-run analysis for selection"
            disabled={documentIdList.length === 0}
          >
            <AnalyzeIcon className="icon-inline" />
          </button>
        ) : null}
        {onDeleteSelection ? (
          <button
            type="button"
            className="icon-button danger selection-action"
            onClick={() => (onDeleteSelection as any)()}
            aria-label="Delete selected items"
            disabled={totalCount === 0}
          >
            <TrashIcon className="icon-inline" />
          </button>
        ) : null}
      </span>
    </>
  );
};

export const SelectionActionBar: React.FC<{ onClearSelection?: () => void }> = ({ onClearSelection }) => {
  const { selectedDocumentIds, selectedFolderIds, clearSelection } = useWorkspaceSelectionContext();
  const documentIds = Array.isArray(selectedDocumentIds) ? selectedDocumentIds : [];
  const folderIds = Array.isArray(selectedFolderIds) ? selectedFolderIds : [];
  const selectionCount = documentIds.length + folderIds.length;
  if (selectionCount === 0) {
    return null;
  }
  const handleClear = onClearSelection || clearSelection;
  return (
    <SelectionActions
      selectionCount={selectionCount}
      selectedDocumentIds={documentIds}
      selectedFolderIds={folderIds}
      onClearSelection={handleClear}
    />
  );
};
