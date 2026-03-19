import { useCallback, useEffect, useState } from 'react';
import type { Identifier } from '../types/identifiers';
import type { DocumentResponse } from '../lib/api/apiTypes';
import { fetchDocument } from '../lib/api/apiClient';

export const useDetailPanel = () => {
  const [detailPanelDocId, setDetailPanelDocId] = useState<Identifier | null>(null);
  const [detailPanelDocument, setDetailPanelDocument] = useState<DocumentResponse | null>(null);

  const detailPanelOpen = detailPanelDocId !== null;

  useEffect(() => {
    if (!detailPanelDocId) {
      setDetailPanelDocument(null);
      return;
    }
    let cancelled = false;
    fetchDocument(detailPanelDocId).then((doc) => {
      if (!cancelled) setDetailPanelDocument(doc);
    }).catch(() => {
      if (!cancelled) setDetailPanelDocument(null);
    });
    return () => { cancelled = true; };
  }, [detailPanelDocId]);

  const openDetailPanel = useCallback(
    (documentId: Identifier) => {
      if (!documentId) return;
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
