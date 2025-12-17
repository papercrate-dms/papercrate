import { useCallback } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import type { Identifier } from '../../types/identifiers';
import type { Correspondent } from '../../types/documents';

import { addDocumentCorrespondent, removeDocumentCorrespondent } from '../../lib/api/apiClient';

import useNotifyApiError from '../../hooks/useNotifyApiError';
import type { CorrespondentsState, DocumentsState } from '../types/workspaceTypes';

interface UseDocumentCorrespondentMutationsArgs {
  correspondentsState: CorrespondentsState;
  documentsState: Pick<DocumentsState, 'documentsManager'>;
}

const useDocumentCorrespondentMutations = ({
  correspondentsState,
  documentsState,
}: UseDocumentCorrespondentMutationsArgs) => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const {
    correspondentManager,
    correspondentLookupByName,
  } = correspondentsState;

  const { documentsManager } = documentsState;

  const handleDocumentCorrespondentAttach = useCallback(
    async (
      {
        documentId,
        correspondentId,
      }: { documentId: Identifier; correspondentId: Identifier; correspondent?: Correspondent | Partial<Correspondent> | null },
      { notify = true }: { notify?: boolean } = {},
    ) => {
      if (documentId == null || correspondentId == null) {
        throw new Error('Missing document or correspondent.');
      }
      try {
        await addDocumentCorrespondent(documentId, correspondentId);

        documentsManager.map((doc) => {
          if (doc.id !== documentId) return undefined;

          const current = Array.isArray(doc.correspondents) ? doc.correspondents : [];
          if (current.includes(correspondentId)) {
            return doc;
          }
          return { ...doc, correspondents: [...current, correspondentId] };
        });

        if (notify) {
          showToast('Correspondent assigned.', 'success');
        }
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to assign correspondent.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [notifyApiError, showToast, documentsManager],
  );

  const handleDocumentCorrespondentDetach = useCallback(
    async (
      { documentId, correspondentId }: { documentId: Identifier; correspondentId: Identifier },
      { notify = true }: { notify?: boolean } = {},
    ) => {
      if (documentId == null || correspondentId == null) {
        throw new Error('Missing document or correspondent.');
      }
      try {
        await removeDocumentCorrespondent(documentId, correspondentId);

        documentsManager.map((doc) => {
          if (doc.id !== documentId) return undefined;
          if (!doc || !Array.isArray(doc.correspondents)) {
            return doc;
          }

          const filtered = doc.correspondents.filter((id) => id !== correspondentId);
          return filtered.length === doc.correspondents.length ? doc : { ...doc, correspondents: filtered };
        });

        if (notify) {
          showToast('Correspondent removed.', 'success');
        }
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to remove correspondent.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [notifyApiError, showToast, documentsManager],
  );

  const normalizeOption = (
    option: Correspondent | Partial<Correspondent> | string | null,
  ): Correspondent | Partial<Correspondent> | null => {
    if (!option) {
      return null;
    }
    if (typeof option === 'string') {
      const trimmed = option.trim();
      if (trimmed) {
        return { id: null, name: trimmed };
      }
      return null;
    }
    return option;
  };

  const handleCorrespondentCreate = useCallback(
    async ({ name }: { name: string }) => {
      const payload = correspondentManager.buildPayload({ name });
      const data = await correspondentManager.create(payload);

      return data;
    },
    [correspondentManager]
  );

  const handleDocumentCorrespondentAdd = useCallback(
    async ({ document, name, input = null, option = null }: { document?: { id?: string }; name?: string; input?: HTMLInputElement | null; option?: Correspondent | Partial<Correspondent> | string | null }) => {
      if (!document?.id) {
        throw new Error('Missing document for correspondent assignment.');
      }
      const trimmed = name?.trim?.() || '';
      if (!trimmed) {
        showToast('Correspondent name is required.', 'error');
        return;
      }

      let target = correspondentLookupByName.get(trimmed.toLowerCase()) || normalizeOption(option);
      if (!target) {
        try {
          target = await handleCorrespondentCreate({ name: trimmed });
          // Force refresh or ingest?
          if (target) {
            const asCorr = target as Correspondent;
            if (asCorr.id) {
              // Creating often yields an object we can use immediately
            }
          }
        } catch {
          showToast('Failed to create correspondent.', 'error');
          return;
        }
      }

      if (!target?.id) {
        showToast('Unable to resolve correspondent.', 'error');
        return;
      }

      try {
        await handleDocumentCorrespondentAttach({
          documentId: document.id,
          correspondentId: target.id,
          correspondent: target.name ? target : { ...target, name: trimmed },
        });
        if (input) {
          input.value = '';
        }
      } catch (error) {
        showToast('Failed to assign correspondent.', 'error');
        console.error('[documents] assign correspondent failed', error);
      }
    },
    [
      correspondentLookupByName,
      handleCorrespondentCreate,
      handleDocumentCorrespondentAttach,
      showToast,
    ],
  );

  return {
    correspondentLookupByName,
    handleDocumentCorrespondentAttach,
    handleDocumentCorrespondentDetach, // Renamed from handleCorrespondentRemove
    handleDocumentCorrespondentAdd, // Renamed from handleCorrespondentAdd
  };
};

export default useDocumentCorrespondentMutations;
