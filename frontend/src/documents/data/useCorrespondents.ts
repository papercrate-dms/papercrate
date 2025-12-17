import { useCallback, useSyncExternalStore, useMemo } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import type { Correspondent } from '../../types/documents';
import type { Identifier } from '../../types/identifiers';
import type CorrespondentManager from '../../lib/assets/CorrespondentManager';

import useNotifyApiError from '../../hooks/useNotifyApiError';

interface UseCorrespondentsOptions {
  correspondentManager: CorrespondentManager;
  documentsManager?: { map: (mapper: (doc: any) => any) => void };
}

const useCorrespondents = ({
  correspondentManager,
  documentsManager,
}: UseCorrespondentsOptions) => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const correspondentsSnapshot = useSyncExternalStore<Map<Identifier, Correspondent>>(
    useCallback((cb) => correspondentManager.subscribe(cb), [correspondentManager]),
    () => correspondentManager.getSnapshot(),
    () => correspondentManager.getSnapshot(),
  );

  const correspondents = Array.from(correspondentsSnapshot.values())
    .filter((corr): corr is Correspondent => (corr as any).id != null && (corr as any).name != null)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const refreshCorrespondents = useCallback(async () => {
    try {
      await correspondentManager.ensureAll(true);
    } catch (error) {
      notifyApiError(error, 'Unable to load correspondents.');
    }
  }, [notifyApiError, correspondentManager]);

  const handleCorrespondentUpdate = useCallback(
    async (correspondentId: Identifier, changes: { name?: string }) => {
      if (correspondentId == null) {
        throw new Error('Missing correspondent identifier.');
      }

      const payload: Record<string, unknown> = {};
      if (changes?.name != null) {
        payload.name = changes.name;
      }

      if (Object.keys(payload).length === 0) {
        return false;
      }

      try {
        await correspondentManager.update(correspondentId, payload);
        showToast('Correspondent updated.', 'success');
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to update correspondent.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [notifyApiError, correspondentManager, showToast],
  );

  const handleCorrespondentCreate = useCallback(
    async ({ name }: { name?: string }) => {
      try {
        const payload = correspondentManager.buildPayload({ name });
        const data = await correspondentManager.create(payload);
        showToast('Correspondent created.', 'success');
        return data;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to create correspondent.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [notifyApiError, correspondentManager, showToast],
  );

  const handleCorrespondentDelete = useCallback(
    async (correspondentId: Identifier) => {
      if (correspondentId == null) {
        throw new Error('Missing correspondent identifier.');
      }

      try {
        await correspondentManager.delete(correspondentId);

        const stripFromDoc = (doc: any) => {
          if (!doc || !Array.isArray(doc.correspondents)) {
            return doc;
          }
          // doc.correspondents is allowed to be Identifier[] now
          const next = doc.correspondents.filter((id: Identifier) => id !== correspondentId);
          if (next.length === doc.correspondents.length) {
            return doc;
          }
          return { ...doc, correspondents: next };
        };

        documentsManager?.map(stripFromDoc);

        showToast('Correspondent deleted.', 'success');
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to delete correspondent.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [documentsManager, notifyApiError, correspondentManager, showToast],
  );

  const correspondentLookupByName = useMemo(() => {
    const map = new Map<string, Correspondent>();
    for (const correspondent of correspondents) {
      if (correspondent.name) {
        map.set(correspondent.name.toLowerCase(), correspondent);
      }
    }
    return map;
  }, [correspondents]);

  return {
    correspondents,
    correspondentLookupById: correspondentsSnapshot,
    correspondentLookupByName,
    refreshCorrespondents,
    handleCorrespondentCreate,
    handleCorrespondentUpdate,
    handleCorrespondentDelete,
    correspondentManager,
  };
};

export default useCorrespondents;
