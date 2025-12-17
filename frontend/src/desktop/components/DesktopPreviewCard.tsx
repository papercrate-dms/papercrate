import { useMemo } from 'react';
import type { JSX } from 'react';
import { resolveDocumentAssetUrl } from '../../lib/assets/AssetManager';
import type { Identifier } from '../../types/identifiers';
import type { Document } from '../../types/documents';

import type { Asset } from '../../types/assets';

type EnsureAssetUrl = (
  documentId: Identifier,
  asset: Asset,
  options?: { force?: boolean;[key: string]: unknown },
) => Promise<unknown>;

type GetDocumentAsset = (document: Document | null, assetType: string) => Asset | null;

interface DesktopPreviewCardProps {
  doc: Document | null;
  title?: string;
  ensureAssetUrl?: EnsureAssetUrl | null;
  getDocumentAsset?: GetDocumentAsset;
  shouldLoad?: boolean;
}

const DesktopPreviewCard = ({
  doc,
  title,
  ensureAssetUrl,
  getDocumentAsset,
  shouldLoad = true,
}: DesktopPreviewCardProps): JSX.Element => {
  const currentUrl = useMemo(() => {
    if (!doc) return null;
    return resolveDocumentAssetUrl(doc, 'thumbnail', {
      ensureAssetUrl: shouldLoad && ensureAssetUrl ? ensureAssetUrl : undefined,
      getAsset: getDocumentAsset,
    });
  }, [doc, ensureAssetUrl, getDocumentAsset, shouldLoad]);

  const hasPreview = Boolean(currentUrl);
  const cardClasses = ['desk-item__card'];
  if (!hasPreview) cardClasses.push('desk-item__card--empty');
  return (
    <div
      className={cardClasses.join(' ')}
      onDragStart={(event) => {
        if (event instanceof DragEvent) {
          event.preventDefault();
        }
      }}
    >
      {hasPreview ? (
        <img
          src={currentUrl}
          alt={title}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        />
      ) : (
        <div className="desk-item__empty">
          <div className="desk-item__placeholder">DOC</div>
          <div className="desk-item__title" title={title}>
            {title}
          </div>
        </div>
      )}
    </div>
  );
};

export default DesktopPreviewCard;
