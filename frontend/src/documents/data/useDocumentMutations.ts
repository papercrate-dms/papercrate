import { useCallback } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import type { DocumentId, FolderNodeId, Identifier } from '../../types/identifiers';
import type { Document, MessageOptions } from '../../types/documents';
import { useDocumentTagMutations } from './useDocumentTagMutations';
import { useDocumentMoveMutations } from './useDocumentMoveMutations';
import type {
  DocumentsState,
  FolderState,
  SelectionState,
  TagsState,
  CorrespondentsState,
} from '../types/workspaceTypes';
import type { Tag, Correspondent } from '../../types/documents';
import useDocumentCorrespondentMutations from './useDocumentCorrespondentMutations';

type NullableFolderId = FolderNodeId | null;

interface DocumentTagExtras {
  option?: Tag | null;
  input?: { value?: string } | null;
}

interface BulkTagOperationArgs {
  labels: string[];
  action: 'add' | 'remove';
  documentIds?: Identifier[];
}

interface BulkTagOperationResult {
  ok: boolean;
  reason?: 'no-labels' | 'no-selection' | 'tag-missing' | 'no-tags' | 'request-failed';
  label?: string;
  tagCount?: number;
  docsCount?: number;
}

type CorrespondentAssignment = {
  correspondent_id?: Identifier;
};

interface UseDocumentMutationsArgs {
  documentsState: DocumentsState;
  folderState: FolderState;
  selectionState: SelectionState;
  tagsState: TagsState;
  correspondentsState: CorrespondentsState;
  closeDocumentViewer: () => void;
  viewerDocumentId?: DocumentId | null;
  resolveTargetDocumentIds: (ids?: Identifier[] | null) => Identifier[];
}

interface UseDocumentMutationsResult {
  moveDocumentsToFolder: (
    documentIds: Array<DocumentId | Document>,
    targetFolderId?: NullableFolderId,
  ) => Promise<void>;
  handleThumbnailRegeneration: (documentId: DocumentId) => Promise<void>;
  handleDocumentsDelete: (
    documentIds: DocumentId[],
    options?: MessageOptions,
  ) => Promise<boolean>;
  handleDocumentTagAdd: (
    document: Document,
    label: string,
    extras?: DocumentTagExtras | null,
  ) => Promise<void>;
  handleDocumentTagAttach: (documentId: DocumentId, tagId: DocumentId) => Promise<boolean>;
  handleDocumentTitleUpdate: (documentId: DocumentId, nextTitle: string) => Promise<boolean>;
  handleDocumentIssuedUpdate: (
    documentId: DocumentId,
    nextIssuedDate: number | null,
  ) => Promise<boolean>;
  handleDocumentTagDetach: (
    documentId?: DocumentId,
    tagId?: DocumentId,
  ) => Promise<boolean>;
  handleDocumentCorrespondentAttach: (args: { documentId: DocumentId; correspondentId: DocumentId; correspondent?: Correspondent | Partial<Correspondent> | null }) => Promise<boolean>;
  handleDocumentCorrespondentDetach: (args: { documentId: DocumentId; correspondentId: DocumentId }) => Promise<boolean>;
  handleDocumentCorrespondentAdd: (args: { document: { id?: string }; name?: string; input?: HTMLInputElement | null; option?: Correspondent | Partial<Correspondent> | string | null }) => Promise<void>;
  handleBulkCorrespondentAdd: (args: { name?: string; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => Promise<void>;
  handleBulkCorrespondentRemove: (args: { assignments?: CorrespondentAssignment[]; documentIds?: Identifier[] }) => Promise<void>;
  handleBulkTagAddFromDetail: (args: { label?: string; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => Promise<void>;
  handleBulkTagRemoveFromDetail: (args: { label?: string; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => Promise<void>;
  handleBulkSelectionReanalyze: (documentIdsOverride?: Identifier[] | null) => Promise<void>;
}

const useDocumentMutations = ({
  documentsState,
  folderState,
  selectionState,
  tagsState,
  correspondentsState,
  closeDocumentViewer,
  viewerDocumentId,
  resolveTargetDocumentIds,
}: UseDocumentMutationsArgs): UseDocumentMutationsResult => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const { moveDocumentsToFolder } = useDocumentMoveMutations({
    documentsState,
    folderState,
    selectionState,
  });

  const {
    handleDocumentTagAdd,
    handleDocumentTagAttach,
    handleDocumentTagDetach,
  } = useDocumentTagMutations({
    tagsState,
    documentsState: { documentsManager: documentsState.documentsManager },
  });

  const {
    handleDocumentCorrespondentAttach,
    handleDocumentCorrespondentDetach,
    handleDocumentCorrespondentAdd,
  } = useDocumentCorrespondentMutations({
    correspondentsState,
    documentsState: { documentsManager: documentsState.documentsManager },
  });

  const handleThumbnailRegeneration = useCallback(
    async (documentId: DocumentId) => {
      try {
        await documentsState.documentsManager.reanalyze(documentId);
        showToast('Analysis queued.', 'info');
        // Close preview if it's the current one to allow refresh?
        if (viewerDocumentId === documentId) {
          closeDocumentViewer();
        }
      } catch (error) {
        notifyApiError(error, 'Failed to queue analysis.');
      }
    },
    [documentsState, closeDocumentViewer, notifyApiError, viewerDocumentId, showToast],
  );

  const handleDocumentsDelete = useCallback(
    async (documentIds: DocumentId[], { showMessage = true }: MessageOptions = {}) => {
      if (!documentIds?.length) return false;

      // Optimistic update could happen here but usually we wait for standardized confirmation
      // However workspace expects mutation here.
      try {
        await Promise.all(documentIds.map((id) => documentsState.documentsManager.trash(id)));
        documentsState.documentsManager.remove(documentIds);

        if (showMessage) {
          const count = documentIds.length;
          const suffix = count === 1 ? '' : 's';
          showToast(`${count} document${suffix} deleted.`, 'success');
        }
        return true;
      } catch (error) {
        const message = (error as Record<string, any>)?.response?.data?.error || 'Failed to delete documents.';
        notifyApiError(error, message);
        return false;
      }
    },
    [
      documentsState,
      notifyApiError,
      showToast,
    ],
  );

  const handleDocumentTitleUpdate = useCallback(
    async (documentId: DocumentId, nextTitle: string) => {
      const trimmed = nextTitle?.trim?.() || '';
      if (!trimmed) {
        showToast('Document title cannot be empty.', 'error');
        return false;
      }
      try {
        await documentsState.documentsManager.updateFields(documentId, { title: trimmed });
        showToast('Document title updated.', 'success');
        return true;
      } catch (error) {
        const message = (error as Record<string, any>)?.response?.data?.error || 'Failed to update document title.';
        notifyApiError(error, message);
        return false;
      }
    },
    [
      documentsState,
      notifyApiError,
      showToast,
    ],
  );

  const handleDocumentIssuedUpdate = useCallback(
    async (documentId: DocumentId, nextIssuedDate: number | null) => {
      const payload = { issued_at: nextIssuedDate || null };
      try {
        await documentsState.documentsManager.updateFields(documentId, payload);
        const message = payload.issued_at ? 'Issued date updated.' : 'Issued date cleared.';
        showToast(message, 'success');
        return true;
      } catch (error) {
        const message = (error as Record<string, any>)?.response?.data?.error || 'Failed to update issued date.';
        notifyApiError(error, message);
        return false;
      }
    },
    [
      documentsState,
      notifyApiError,
      showToast,
    ],
  );

  const bulkTagOperation = useCallback(
    async ({ labels, action, documentIds }: BulkTagOperationArgs): Promise<BulkTagOperationResult> => {
      if (!labels?.length) return { ok: false, reason: 'no-labels' };

      const targetIds = resolveTargetDocumentIds(documentIds);
      if (!targetIds?.length) return { ok: false, reason: 'no-selection' };

      const existingTags = tagsState.tags || [];
      const tagMap = new Map(existingTags.map((t) => [t.label, t]));

      const tagsToProcess: Tag[] = [];
      const labelsToCreate: string[] = [];

      for (const lbl of labels) {
        const tag = tagMap.get(lbl);
        if (tag) {
          tagsToProcess.push(tag);
        } else if (action === 'add') {
          labelsToCreate.push(lbl);
        }
      }

      for (const lbl of labelsToCreate) {
        try {
          const payload = tagsState.tagManager.buildPayload({ label: lbl });
          const created = await tagsState.tagManager.create(payload);
          if (created) {
            tagsToProcess.push(created as Tag);
          }
        } catch (e) {
          console.error('Failed to create tag', lbl, e);
        }
      }

      if (!tagsToProcess.length && action === 'add') {
        return { ok: false, reason: 'tag-missing' };
      }

      try {
        const tagIds = tagsToProcess.map(t => t.id);
        await documentsState.documentsManager.bulkTag(targetIds, tagIds, action);

        return { ok: true, docsCount: targetIds.length, tagCount: tagsToProcess.length, label: labels[0] };
      } catch (e) {
        notifyApiError(e, 'Bulk tag operation failed');
        return { ok: false, reason: 'request-failed' };
      }
    },
    [documentsState, resolveTargetDocumentIds, tagsState, notifyApiError]
  );

  const handleBulkTagAddFromDetail = useCallback(async ({ label, tagId, input, documentIds }: { label?: string; tagId?: Identifier; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => {
    if (tagId) {
      const targetIds = resolveTargetDocumentIds(documentIds);
      if (!targetIds.length) return;
      try {
        await documentsState.documentsManager.bulkTag(targetIds, [tagId], 'add');
        showToast(`Added tag "${label || ''}" to ${targetIds.length} documents.`, 'success');
        if (input) input.value = '';
      } catch (e) {
        notifyApiError(e, 'Bulk tag operation failed');
      }
      return;
    }
    const text = label || input?.value?.trim();
    if (!text) return;

    const res = await bulkTagOperation({ labels: [text], action: 'add', documentIds });
    if (res.ok) {
      showToast(`Added tag "${text}" to ${res.docsCount} documents.`, 'success');
      if (input) input.value = '';
    }
  }, [bulkTagOperation, documentsState, resolveTargetDocumentIds, showToast, notifyApiError]);

  const handleBulkTagRemoveFromDetail = useCallback(async ({ label, tagId, input, documentIds }: { label?: string; tagId?: Identifier; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => {
    if (tagId) {
      const targetIds = resolveTargetDocumentIds(documentIds);
      if (!targetIds.length) return;
      try {
        await documentsState.documentsManager.bulkTag(targetIds, [tagId], 'remove');
        showToast(`Removed tag "${label || ''}" from ${targetIds.length} documents.`, 'success');
      } catch (e) {
        notifyApiError(e, 'Bulk tag operation failed');
      }
      return;
    }
    const text = label || input?.value?.trim();
    if (!text) return;

    const res = await bulkTagOperation({ labels: [text], action: 'remove', documentIds });
    if (res.ok) {
      showToast(`Removed tag "${text}" from ${res.docsCount} documents.`, 'success');
    }
  }, [bulkTagOperation, documentsState, resolveTargetDocumentIds, showToast, notifyApiError]);

  const handleBulkSelectionReanalyze = useCallback(async (documentIdsOverride?: Identifier[] | null) => {
    const ids = resolveTargetDocumentIds(documentIdsOverride || undefined);
    if (!ids.length) {
      showToast('No documents selected.', 'info');
      return;
    }
    try {
      await documentsState.documentsManager.bulkReanalyze(ids);
      showToast(`Queued reanalysis for ${ids.length} documents.`, 'success');
    } catch (e) {
      notifyApiError(e, 'Failed to queue reanalysis');
    }
  }, [resolveTargetDocumentIds, showToast, notifyApiError]);

  const handleBulkCorrespondentAdd = useCallback(async ({ name, correspondentId, input, documentIds }: { name?: string; correspondentId?: Identifier; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => {
    const ids = resolveTargetDocumentIds(documentIds);
    if (!ids.length) return;

    const { correspondentManager, correspondentLookupByName, correspondentLookupById } = correspondentsState;

    let corr = correspondentId ? correspondentLookupById?.get(correspondentId) ?? { id: correspondentId, name: name || '' } : null;

    if (!corr) {
      const text = name || input?.value?.trim();
      if (!text) return;
      const normalized = text.trim();

      corr = correspondentLookupByName?.get(normalized.toLowerCase()) ?? null;

      if (!corr) {
        try {
          const payload = correspondentManager.buildPayload({ name: normalized });
          corr = await correspondentManager.create(payload);
        } catch (e) {
          console.error('Failed to create correspondent', e);
          showToast('Failed to create correspondent.', 'error');
          return;
        }
      }
    }

    if (!corr?.id) {
      showToast('Correspondent could not be found or created.', 'error');
      return;
    }

    try {
      await documentsState.documentsManager.bulkCorrespondent(
        ids,
        [{ correspondent_id: corr.id }],
        'add',
      );
      showToast(`Assigned "${corr.name}" to ${ids.length} documents.`, 'success');
      if (input) input.value = '';
    } catch (e) {
      notifyApiError(e, 'Failed to assign correspondent');
    }
  }, [documentsState, correspondentsState, resolveTargetDocumentIds, showToast, notifyApiError]);

  const handleBulkCorrespondentRemove = useCallback(async ({ documentIds }: { documentIds?: Identifier[] }) => {
    const ids = resolveTargetDocumentIds(documentIds);
    if (!ids.length) return;

    const correspondentsToRemove = new Set<Identifier>();
    ids.forEach(docId => {
      const doc = documentsState.documentLookup.get(docId);
      if (doc?.correspondents?.length) {
        doc.correspondents.forEach(cId => correspondentsToRemove.add(cId));
      }
    });

    if (correspondentsToRemove.size === 0) {
      showToast('No correspondents found to remove.', 'info');
      return;
    }

    const assignments = Array.from(correspondentsToRemove).map(id => ({ correspondent_id: id }));

    try {
      await documentsState.documentsManager.bulkCorrespondent(ids, assignments, 'remove');
      showToast(`Removed correspondents from ${ids.length} documents.`, 'success');
    } catch (e) {
      notifyApiError(e, 'Failed to remove correspondents');
    }
  }, [documentsState, resolveTargetDocumentIds, showToast, notifyApiError]);

  return {
    moveDocumentsToFolder,
    handleThumbnailRegeneration,
    handleDocumentsDelete,
    handleDocumentTagAdd,
    handleDocumentTagAttach,
    handleDocumentTitleUpdate,
    handleDocumentIssuedUpdate,
    handleDocumentTagDetach,
    handleDocumentCorrespondentAttach,
    handleDocumentCorrespondentDetach,
    handleDocumentCorrespondentAdd,
    handleBulkCorrespondentAdd,
    handleBulkCorrespondentRemove,
    handleBulkTagAddFromDetail,
    handleBulkTagRemoveFromDetail,
    handleBulkSelectionReanalyze,
  };
};

export default useDocumentMutations;
