import { useEffect, useCallback, useSyncExternalStore } from 'react';
import { useDocumentsSearch } from '../lib/context/DocumentsSearchContext';
import type { DocumentId } from '../types/identifiers';
import type { Document } from '../types/documents';

/**
 * Resolve a single document by ID from the shared DocumentsManager.
 *
 * - Returns the cached document immediately if available.
 * - Triggers a fetch via `ensure()` if not yet cached.
 * - Subscribes to the manager so the returned value stays reactive
 *   (e.g. updates when a tag is added or title is changed).
 */
const useDocument = (documentId: DocumentId | null): Document | null => {
  const { documentsManager } = useDocumentsSearch();

  // Kick off fetch when the ID changes (no-op if already cached)
  useEffect(() => {
    if (!documentId) return;
    documentsManager.ensure(documentId);
  }, [documentId, documentsManager]);

  const getDocument = useCallback(
    () => (documentId ? documentsManager.getById(documentId) : null),
    [documentId, documentsManager],
  );

  const subscribe = useCallback(
    (cb: () => void) => documentsManager.subscribe(cb),
    [documentsManager],
  );

  return useSyncExternalStore(subscribe, getDocument, getDocument);
};

export default useDocument;
