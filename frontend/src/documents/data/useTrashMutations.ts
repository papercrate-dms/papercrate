import { useCallback } from 'react';
import { useDocumentsSearch } from '../../lib/context/DocumentsSearchContext';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import { useUI } from '../../lib/context/UIContext';
import type { DocumentId, Identifier } from '../../types/identifiers';
import type { Document } from '../../types/documents';

export function useTrashMutations() {
  const { documentLookup, documentsManager } = useDocumentsSearch();
  const { showToast } = useStatusToast();
  const { notifyApiError } = useUI();

  const trashDocuments = useCallback(async (ids: DocumentId[]) => {
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => documentsManager.trash(id)));
      documentsManager.remove(ids);
      const count = ids.length;
      showToast(`Moved ${count} document${count === 1 ? '' : 's'} to trash.`, 'success');
    } catch (error) {
      notifyApiError(error, 'Failed to trash documents.');
    }
  }, [documentsManager, showToast, notifyApiError]);

  const restoreDocuments = useCallback(async (ids: DocumentId[]) => {
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => {
        const doc = documentLookup?.get(id) as Document | undefined;
        return documentsManager.restore(id, doc?.folder_id as Identifier ?? null);
      }));
      documentsManager.remove(ids);
      const count = ids.length;
      showToast(`Restored ${count} document${count === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notifyApiError(error, 'Failed to restore documents.');
    }
  }, [documentLookup, documentsManager, showToast, notifyApiError]);

  const purgeDocuments = useCallback(async (ids: DocumentId[]) => {
    if (!ids.length) return;
    const count = ids.length;
    const confirmed = window.confirm(
      `Permanently delete ${count} document${count === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await Promise.all(ids.map((id) => documentsManager.purge(id)));
      documentsManager.remove(ids);
      showToast(`Permanently deleted ${count} document${count === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notifyApiError(error, 'Failed to delete documents.');
    }
  }, [documentsManager, showToast, notifyApiError]);

  return { trashDocuments, restoreDocuments, purgeDocuments };
}
