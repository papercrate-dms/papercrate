import React, { useMemo } from 'react';
import DesktopPreviewCard from './DesktopPreviewCard';
import { resolveCorrespondents } from '../../documents/correspondents';
import type { Document } from '../../types/documents';
import { LayoutCard } from '../logic/LayoutSystem';
import { useCardPointer } from '../interactions/useCardPointer';
import DocumentTags from '../../documents/components/DocumentTags';
import { TagInteractionHandlers } from '../../documents/interactions/useTagInteractions';
import { useDocumentsAssetContext } from '../../documents/context/DocumentsAssetContext';
import { useDocumentsViewStateContext } from '../../documents/context/DocumentsViewStateContext';

const preventAll = (event?: React.SyntheticEvent | Event | null) => {
  if (!event) return;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
};

interface DesktopDocumentCardProps {
  doc: Document;
  style?: React.CSSProperties;
  shouldLoad?: boolean;
  matchesFilter?: boolean;
  selected?: boolean;
  docTagTokens?: string;
  ensureAssetUrl?: (...args: any[]) => Promise<unknown>;
  getDocumentAsset?: (...args: any[]) => unknown;
  onDocumentActivate?: (id: string, event?: any) => void;
  onSelect: (ids: string[], extend?: boolean) => void;
  onDeselect: (ids: string[]) => void;
  selection: string[];
  requestCanvasFocus?: () => void;
  tagHandlers?: TagInteractionHandlers;
  layoutCard: LayoutCard;
}

const DesktopDocumentCard: React.FC<DesktopDocumentCardProps> = ({
  doc,
  style,
  shouldLoad = false,
  matchesFilter = true,
  selected = false,
  docTagTokens,
  onDocumentActivate,
  onSelect,
  onDeselect,
  selection,
  requestCanvasFocus,
  tagHandlers,
  layoutCard,
}) => {
  const {
    ensureAssetUrl,
    getDocumentAsset
  } = useDocumentsAssetContext();

  const { tagLookupById, correspondentLookupById } = useDocumentsViewStateContext();
  const cardPointerHandlers = useCardPointer(
    layoutCard,
    !!selected,
    selection,
    onSelect,
    onDeselect,
    onDocumentActivate,
    requestCanvasFocus
  );

  const correspondents = useMemo(() => resolveCorrespondents(doc, correspondentLookupById), [doc, correspondentLookupById]);
  const tags = Array.isArray(doc?.tags) ? doc.tags : [];

  const itemClasses = ['desk-item'];
  if (!matchesFilter) itemClasses.push('is-filtered-out');
  if (selected) itemClasses.push('is-selected');

  const ariaHidden = matchesFilter ? undefined : 'true';
  const dataTagIds = docTagTokens || undefined;

  return (
    <div
      key={doc.id}
      className={itemClasses.join(' ')}
      style={style}
      role="button"
      data-doc-id={doc.id}
      data-tag-ids={dataTagIds}
      aria-hidden={ariaHidden}
      ref={(node) => layoutCard?.setRef(node)}
      {...cardPointerHandlers}
      onDragEnter={(event) => tagHandlers?.onTagDragEnter(event, doc.id!)}
      onDragOver={(event) => tagHandlers?.onTagDragOver(event, doc)}
      onDragLeave={(event) => tagHandlers?.onTagDragLeave(event, doc.id!)}
      onDrop={(event) => tagHandlers?.onTagDrop(event, doc)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          preventAll(event);
          onDocumentActivate?.(doc.id, event);
        }
      }}
    >
      <div className="desk-item__body">
        <DesktopPreviewCard
          doc={doc}
          title={doc.title}
          ensureAssetUrl={ensureAssetUrl}
          getDocumentAsset={getDocumentAsset}
          shouldLoad={shouldLoad}
        />
        {correspondents.length > 0 && (
          <div className="desk-item__correspondents" aria-hidden="true">
            {correspondents.map((correspondent) => (
              <span
                key={correspondent.key}
                className="badge desk-correspondent-chip"
                title={correspondent.name}
              >
                <span className="desk-correspondent-chip__label">{correspondent.name}</span>
              </span>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="desk-item__tags" aria-hidden="true">
            <DocumentTags
              doc={doc}
              tags={tags}
              tagLookupById={tagLookupById}
              tagHandlers={tagHandlers}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(DesktopDocumentCard);
