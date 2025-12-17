import { useEffect, useState, useRef } from 'react';
import type { DocumentId } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import type { Asset, ThumbnailMetadata } from '../../types/assets';

interface PreviewMetadataEntry {
  docId: DocumentId;
  width: number;
  height: number;
}

type GetDocumentAsset = (doc: Document, type: string) => Asset | null;
type EnsureAssetUrl = (docId: DocumentId, asset: Asset, options?: { force?: boolean }) => Promise<Asset | null>;

const usePreviewMetadata = (
  documents: Document[] | null,
  getDocumentAsset?: GetDocumentAsset,
  ensureAssetUrl?: EnsureAssetUrl,
) => {
  const [metadataMap, setMetadataMap] = useState<Map<string, PreviewMetadataEntry>>(() => new Map());
  const failedIds = useRef(new Set<string>()); // Track failed fetches to prevent loops

  useEffect(() => {
    let cancelled = false;
    const docs = Array.isArray(documents) ? documents : [];
    if (!docs.length) {
      setMetadataMap(new Map());
      return () => {
        cancelled = true;
      };
    }

    const fetchMetadataForDoc = async (doc: Document) => {
      if (!doc?.id) {
        return null;
      }

      const docId = String(doc.id);
      const resolveAsset = (type: string) => getDocumentAsset?.(doc, type) ?? null;

      let asset = resolveAsset('thumbnail');
      let metadata: Partial<ThumbnailMetadata> | null = (asset?.metadata as Partial<ThumbnailMetadata> | null) || null;

      const hasDimensions = (meta: Partial<ThumbnailMetadata> | null): meta is ThumbnailMetadata =>
        typeof meta?.width === 'number' &&
        typeof meta?.height === 'number' &&
        meta.width > 0 &&
        meta.height > 0;

      if (!hasDimensions(metadata) && ensureAssetUrl && docId && asset?.id) {
        // Skip if we already failed for this doc to avoid infinite loops
        if (!failedIds.current.has(docId)) {
          try {
            const ensured = await ensureAssetUrl(doc.id, asset);
            if (ensured) {
              asset = ensured;
              metadata = (asset?.metadata as Partial<ThumbnailMetadata> | null) || null;
            }

            // If still no dimensions, mark as failed so we don't try again
            if (!hasDimensions(metadata)) {
              failedIds.current.add(docId);
            }
          } catch (error) {
            console.warn('[desk] ensureDocumentSize metadata fetch failed', error);
            failedIds.current.add(docId);
          }
        }
      }

      if (!hasDimensions(metadata)) {
        return null;
      }

      return {
        docId,
        width: Number(metadata.width),
        height: Number(metadata.height),
      };
    };

    let mounted = true;
    (async () => {
      const entries = await Promise.all(docs.map(fetchMetadataForDoc));
      if (!mounted || cancelled) {
        return;
      }
      const next = new Map();
      entries.forEach((entry) => {
        if (entry && entry.docId) {
          next.set(entry.docId, entry);
        }
      });
      if (!cancelled) {
        setMetadataMap(next);
      }
    })();

    return () => {
      cancelled = true;
      mounted = false;
    };
  }, [documents, getDocumentAsset, ensureAssetUrl]);

  return metadataMap;
};

export default usePreviewMetadata;
