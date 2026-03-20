import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import AssetManager from '../../lib/assets/AssetManager';
import TagManager from '../../lib/assets/TagManager';
import CorrespondentManager from '../../lib/assets/CorrespondentManager';
import FoldersManager from '../FoldersManager';
import { fetchAsset, fetchDocument } from '../../lib/api/apiClient';
import useDocuments from './useDocuments';
import type { DocumentId, Identifier } from '../../types/identifiers';
import type { Tag, Correspondent } from '../../types/documents';

const useWorkspaceManagers = () => {
  // --- AssetManager ---
  const assetManagerRef = useRef(null);
  if (!assetManagerRef.current) {
    const fetcher = async (id: Identifier) => {
      const asset = await fetchAsset(id);
      return (asset as unknown) as any;
    };
    assetManagerRef.current = new AssetManager({ fetchAsset: fetcher });
  }
  const assetManager = assetManagerRef.current;

  // --- TagManager ---
  const tagManagerRef = useRef(null);
  if (!tagManagerRef.current) {
    tagManagerRef.current = new TagManager();
  }
  const tagManager = tagManagerRef.current;

  // --- CorrespondentManager ---
  const correspondentManagerRef = useRef<CorrespondentManager | null>(null);
  if (!correspondentManagerRef.current) {
    correspondentManagerRef.current = new CorrespondentManager();
  }
  const correspondentManager = correspondentManagerRef.current;

  // --- FoldersManager ---
  const foldersManagerRef = useRef<FoldersManager | null>(null);
  if (!foldersManagerRef.current) {
    foldersManagerRef.current = new FoldersManager();
  }
  const foldersManager = foldersManagerRef.current;

  // --- Documents ---
  const extractDocumentFromResponse = useCallback(
    (payload) => {
      if (!payload) return null;
      return payload.document || payload;
    },
    [],
  );

  const fetchDocumentById = useCallback(
    async (documentId: DocumentId) => {
      if (!documentId) return null;
      const data = await fetchDocument(documentId);
      return extractDocumentFromResponse(data);
    },
    [extractDocumentFromResponse],
  );

  const {
    documents,
    setDocuments,
    documentsManager,
  } = useDocuments({ fetchDocumentById });

  // Cross-wire managers so DocumentsManager can resolve tag/correspondent labels
  useEffect(() => {
    if (tagManager) {
      documentsManager.setTagManager(tagManager);
    }
    if (correspondentManager) {
      documentsManager.setCorrespondentManager(correspondentManager);
    }
  }, [documentsManager, tagManager, correspondentManager]);

  const documentLookup = useSyncExternalStore(
    (onStoreChange) => documentsManager.subscribe(onStoreChange),
    () => documentsManager.getSnapshot(),
    () => documentsManager.getSnapshot(),
  );

  // Minimal snapshots for mutation wiring — full CRUD state lives in TagsProvider/CorrespondentsProvider
  const tagSnapshot = useSyncExternalStore(
    useCallback((cb) => tagManager.subscribe(cb), [tagManager]),
    () => tagManager.getSnapshot(),
    () => tagManager.getSnapshot(),
  );
  const correspondentSnapshot = useSyncExternalStore(
    useCallback((cb) => correspondentManager.subscribe(cb), [correspondentManager]),
    () => correspondentManager.getSnapshot(),
    () => correspondentManager.getSnapshot(),
  );
  const tagsForMutations = Array.from(tagSnapshot.values()) as Tag[];
  const correspondentsForMutations = Array.from(correspondentSnapshot.values()) as Correspondent[];

  const foldersSnapshot = useSyncExternalStore(
    useCallback((cb) => foldersManager.subscribe(cb), [foldersManager]),
    () => foldersManager.getSnapshot(),
    () => foldersManager.getSnapshot(),
  );

  return {
    // Manager instances
    assetManager,
    tagManager,
    correspondentManager,
    foldersManager,
    documentsManager,
    // Document state
    documents,
    setDocuments,
    documentLookup,
    extractDocumentFromResponse,
    // Snapshots for mutations
    tagSnapshot,
    correspondentSnapshot,
    tagsForMutations,
    correspondentsForMutations,
    foldersSnapshot,
  };
};

export default useWorkspaceManagers;
