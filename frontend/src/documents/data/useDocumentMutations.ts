import { useCallback } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import useNotifyApiError from '../../hooks/useNotifyApiError';

import {
  queueDocumentReanalysis,
  trashDocument,
  updateDocument,
  createTag,
  bulkTagDocuments,
  bulkReanalyzeDocuments,
  assignCorrespondentsBulk,
} from '../../lib/api/apiClient';
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
        await queueDocumentReanalysis(documentId);
        showToast('Analysis queued.', 'info');
        // Close preview if it's the current one to allow refresh?
        if (viewerDocumentId === documentId) {
          closeDocumentViewer();
        }
      } catch (error) {
        notifyApiError(error, 'Failed to queue analysis.');
      }
    },
    [closeDocumentViewer, notifyApiError, viewerDocumentId, showToast],
  );

  const handleDocumentsDelete = useCallback(
    async (documentIds: DocumentId[], { showMessage = true }: MessageOptions = {}) => {
      if (!documentIds?.length) return false;

      // Optimistic update could happen here but usually we wait for standardized confirmation
      // However workspace expects mutation here.
      try {
        await Promise.all(documentIds.map((id) => trashDocument(id)));

        // Remove from local state and manager
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
        const data = await updateDocument(documentId, { title: trimmed });
        const updatedDocument = documentsState.extractDocumentFromResponse?.(data);

        if (updatedDocument && documentsState.ingestDocuments) {
          documentsState.ingestDocuments([updatedDocument]);
        } else {
          documentsState.documentsManager.update(documentId, (doc) => {
            if (updatedDocument) {
              return { ...doc, ...updatedDocument };
            }
            return { ...doc, title: trimmed };
          });
        }

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
        const data = await updateDocument(documentId, payload);
        const updatedDocument = documentsState.extractDocumentFromResponse?.(data);

        if (updatedDocument && documentsState.ingestDocuments) {
          documentsState.ingestDocuments([updatedDocument]);
        } else {
          documentsState.documentsManager.update(documentId, (doc) => {
            if (updatedDocument) {
              return { ...doc, ...updatedDocument };
            }
            return { ...doc, issued_at: payload.issued_at };
          });
        }

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
          // Use API directly to create tag
          const created = await createTag({ label: lbl, color: '#c0c0c0' });
          if (created) {
            tagsToProcess.push(created as Tag);
            if (tagsState.tagManager && typeof tagsState.tagManager.ingest === 'function') {
              tagsState.tagManager.ingest([created as Tag]);
            }
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
        await bulkTagDocuments({ document_ids: targetIds, tag_ids: tagIds, action });

        documentsState.documentsManager.map((doc) => {
          if (!targetIds.includes(doc.id)) return undefined;
          const oldTags = doc.tags || [];
          let newTags = [...oldTags];
          const processIds = new Set(tagIds);

          if (action === 'add') {
            const currentIds = new Set(oldTags);
            tagIds.forEach(tid => {
              if (!currentIds.has(tid)) newTags.push(tid);
            });
          } else {
            newTags = newTags.filter(tid => !processIds.has(tid));
          }
          return { ...doc, tags: newTags };
        });

        return { ok: true, docsCount: targetIds.length, tagCount: tagsToProcess.length, label: labels[0] };
      } catch (e) {
        notifyApiError(e, 'Bulk tag operation failed');
        return { ok: false, reason: 'request-failed' };
      }
    },
    [documentsState, resolveTargetDocumentIds, tagsState, notifyApiError]
  );

  const handleBulkTagAddFromDetail = useCallback(async ({ label, input, documentIds }: { label?: string; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => {
    const text = label || input?.value?.trim();
    if (!text) return;

    const res = await bulkTagOperation({ labels: [text], action: 'add', documentIds });
    if (res.ok) {
      showToast(`Added tag "${text}" to ${res.docsCount} documents.`, 'success');
      if (input) input.value = '';
    }
  }, [bulkTagOperation, showToast]);

  const handleBulkTagRemoveFromDetail = useCallback(async ({ label, input, documentIds }: { label?: string; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => {
    const text = label || input?.value?.trim();
    if (!text) return;

    const res = await bulkTagOperation({ labels: [text], action: 'remove', documentIds });
    if (res.ok) {
      showToast(`Removed tag "${text}" from ${res.docsCount} documents.`, 'success');
    }
  }, [bulkTagOperation, showToast]);

  const handleBulkSelectionReanalyze = useCallback(async (documentIdsOverride?: Identifier[] | null) => {
    const ids = resolveTargetDocumentIds(documentIdsOverride || undefined);
    if (!ids.length) {
      showToast('No documents selected.', 'info');
      return;
    }
    try {
      await bulkReanalyzeDocuments({ document_ids: ids });
      showToast(`Queued reanalysis for ${ids.length} documents.`, 'success');
    } catch (e) {
      notifyApiError(e, 'Failed to queue reanalysis');
    }
  }, [resolveTargetDocumentIds, showToast, notifyApiError]);

  const handleBulkCorrespondentAdd = useCallback(async ({ name, input, documentIds }: { name?: string; input?: HTMLInputElement | null; documentIds?: Identifier[] }) => {
    const text = name || input?.value?.trim();
    if (!text) return;
    const ids = resolveTargetDocumentIds(documentIds);
    if (!ids.length) return;

    const { correspondentManager, correspondentLookupByName } = correspondentsState;
    const normalized = text.trim();

    let corr = correspondentLookupByName?.get(normalized.toLowerCase());

    if (!corr) {
      try {
        // Create new correspondent
        const payload = correspondentManager.buildPayload({ name: normalized });
        corr = await correspondentManager.create(payload);
      } catch (e) {
        console.error('Failed to create correspondent', e);
        showToast('Failed to create correspondent.', 'error');
        return;
      }
    }

    if (!corr) {
      showToast('Correspondent could not be found or created.', 'error');
      return;
    }

    try {
      await assignCorrespondentsBulk({
        document_ids: ids,
        assignments: [{ correspondent_id: corr.id }],
        action: 'add'
      });

      documentsState.documentsManager.map((doc) => {
        if (ids.includes(doc.id)) {
          const current = doc.correspondents || [];
          if (corr?.id && !current.includes(corr.id)) {
            return { ...doc, correspondents: [...current, corr.id] };
          }
        }
        return undefined;
      });
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
      await assignCorrespondentsBulk({
        document_ids: ids,
        assignments,
        action: 'remove'
      });

      documentsState.documentsManager.map((doc) => {
        if (ids.includes(doc.id)) {
          // Remove any of the targeted correspondents from the document
          const current = doc.correspondents || [];
          const newCorrespondents = current.filter(cId => !correspondentsToRemove.has(cId));
          if (current.length !== newCorrespondents.length) {
            return { ...doc, correspondents: newCorrespondents };
          }
        }
        return undefined;
      });
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
