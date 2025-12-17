import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import DocumentsManager from '../DocumentsManager';
import type { DocumentId } from '../../types/identifiers';
import type { Document } from '../../types/documents';

interface UseDocumentsOptions {
  fetchDocumentById?: (id: DocumentId) => Promise<Document | null>;
}

const useDocuments = ({
  fetchDocumentById,
}: UseDocumentsOptions) => {
  const managerRef = useRef(
    new DocumentsManager<Document>(fetchDocumentById),
  );
  // Store only IDs in local state
  const [documentIds, setDocumentIds] = useState<DocumentId[]>([]);

  useEffect(() => {
    managerRef.current.setFetcher(fetchDocumentById);
  }, [fetchDocumentById]);

  // Subscribe to the manager for reactive updates
  const managerSnapshot = useSyncExternalStore(
    useCallback((cb) => managerRef.current.subscribe(cb), []),
    () => managerRef.current.getSnapshot(),
    () => managerRef.current.getSnapshot(),
  );

  // Derive the full document objects from IDs + Snapshot
  const documents = useMemo(() => {
    if (!documentIds.length) return [];

    // Efficiently map IDs to current document objects from the snapshot
    // If an ID is missing in the snapshot (unlikely if ingested correctly), return null/undefined and filter
    return documentIds
      .map(id => managerSnapshot.get(id))
      .filter((doc): doc is Document => Boolean(doc));
  }, [documentIds, managerSnapshot]);

  // Keep a ref to the latest documents to avoid setDocuments dependency
  const documentsRef = useRef(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const setDocuments = useCallback(
    (value: Document[] | ((prev: Document[]) => Document[])) => {
      // Support functional updates using the current derived documents as the previous state.
      // Use ref to avoid re-creating this callback when documents change.
      const prevDocs = documentsRef.current;
      const newDocs = typeof value === 'function' ? value(prevDocs) : value;

      if (!Array.isArray(newDocs)) {
        return;
      }

      const { canonical } = managerRef.current.ingest(newDocs);
      const newIds = canonical.map(d => d.id as DocumentId).filter(Boolean);
      setDocumentIds(newIds);
    },
    [] // Stable callback
  );

  return {
    documents,
    setDocuments,
    documentsManager: managerRef.current,
  };
};

export default useDocuments;
