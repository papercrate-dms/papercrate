import { useCallback, useEffect, useState } from 'react';
import type { Identifier } from '../types/identifiers';

interface DetailDocument {
  id?: Identifier;
  [key: string]: unknown;
}

interface UseDetailPanelOptions {
  documentLookup: Map<Identifier, DetailDocument>;
}

export const useDetailPanel = ({
  documentLookup,
}: UseDetailPanelOptions) => {
  const [detailPanelDocId, setDetailPanelDocId] = useState<Identifier | null>(null);
  const [detailPanelDocument, setDetailPanelDocument] = useState<DetailDocument | null>(null);

  const detailPanelOpen = detailPanelDocId !== null;

  useEffect(() => {
    if (!detailPanelDocId) {
      setDetailPanelDocument(null);
      return;
    }
    const resolved = documentLookup.get(detailPanelDocId) ?? null;
    if (resolved !== detailPanelDocument) {
      setDetailPanelDocument(resolved);
    }
  }, [detailPanelDocId, documentLookup, detailPanelDocument]);

  const openDetailPanel = useCallback(
    (documentId: Identifier) => {
      if (!documentId) {
        return;
      }
      setDetailPanelDocId(documentId);
    },
    [],
  );

  const closeDetailPanel = useCallback(() => {
    setDetailPanelDocId(null);
  }, []);

  return {
    detailPanelOpen,
    detailPanelDocument,
    openDetailPanel,
    closeDetailPanel,
  };
};
