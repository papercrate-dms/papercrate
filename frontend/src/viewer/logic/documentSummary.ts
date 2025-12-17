import { formatFileSize } from '../../utils/format';
import { formatDateTime as defaultFormatDateTime } from '../../utils/date';
import { DEFAULT_FOLDER_NAME } from '../../app/workspaceUtils';
import type { Identifier } from '../../types/identifiers';
import type { Correspondent, Document, Tag } from '../../types/documents';

interface DescribeSummaryOptions {
  formatDateTime?: typeof defaultFormatDateTime;
  tagLookupById?: Map<Identifier, Tag> | null;
  correspondentLookupById?: Map<Identifier, Correspondent> | null;
}

type DocumentSummaryRowType = 'text' | 'editable-title' | 'editable-issued' | 'tags' | 'correspondents' | 'folder';

export interface DocumentSummaryRow {
  key: string;
  label: string;
  value: string | null;
  kind?: DocumentSummaryRowType;
}

type DocumentSummary = DocumentSummaryRow[];

const coercePageCount = (metadata?: { page_count?: number | string | null } | null): number | null => {
  const raw = metadata?.page_count;
  if (raw == null || raw === '') {
    return null;
  }
  const parsed = Number.parseInt(String(raw), 10);
  return parsed >= 0 ? parsed : null;
};

const sanitizeArray = <T>(entries?: Array<T | null> | null): T[] =>
  Array.isArray(entries) ? entries.filter(Boolean) as T[] : [];

interface DocumentMetadataPayload {
  [key: string]: unknown;
}

export const describeDocumentSummary = (document?: Document | null, options: DescribeSummaryOptions = {}): DocumentSummary => {
  const {
    formatDateTime = defaultFormatDateTime,
    tagLookupById,
    correspondentLookupById,
  } = options;

  const formatDateLabel = (value?: string | number | null) => {
    if (typeof value === 'number') {
      return formatDateTime(new Date(value)) || '—';
    }
    return formatDateTime(value) || '—';
  };
  const doc = document ?? ({} as Document);
  const sizeBytes = doc.current_version?.size_bytes ?? null;
  const sizeLabel = sizeBytes !== null && sizeBytes > 0 ? formatFileSize(sizeBytes) : '—';
  const metadata = doc.current_version?.metadata || null;
  const pageCount = coercePageCount(metadata);
  const pageCountLabel = pageCount !== null ? String(pageCount) : '—';
  const folderLabel = doc.folder_id == null ? DEFAULT_FOLDER_NAME : `Folder ${doc.folder_id} `;
  const tags = sanitizeArray<Identifier>(doc.tags);
  const correspondents = sanitizeArray<Identifier>(doc.correspondents);

  const tagLabels = tags
    .map((tagId) => tagLookupById?.get(tagId)?.label)
    .filter(Boolean) as string[];

  const correspondentLabels = correspondents
    .map((id) => correspondentLookupById?.get(id)?.name)
    .filter(Boolean) as string[];

  const tagsSummary = tagLabels.length ? tagLabels.join(', ') : '—';
  const correspondentsSummary = correspondentLabels.length ? correspondentLabels.join(', ') : '—';
  return [
    { key: 'title', label: 'Title', value: doc.title ?? null, kind: 'editable-title' },
    { key: 'tags', label: 'Tags', value: tagsSummary, kind: 'tags' },
    { key: 'correspondents', label: 'Correspondents', value: correspondentsSummary, kind: 'correspondents' },
    { key: 'issued', label: 'Issued', value: formatDateLabel(doc.issued_at), kind: 'editable-issued' },
    { key: 'created', label: 'Created at', value: formatDateLabel(doc.created_at) },
    { key: 'updated', label: 'Updated at', value: formatDateLabel(doc.updated_at) },
    { key: 'folder', label: 'Folder', value: folderLabel, kind: 'folder' },
    { key: 'size', label: 'Size', value: sizeLabel },
    { key: 'mime-type', label: 'MIME type', value: doc.mime_type || 'Unknown' },
    { key: 'pages', label: 'Pages', value: pageCountLabel },
    { key: 'filename', label: 'Filename', value: doc.filename },
    { key: 'original-filename', label: 'Original filename', value: doc.original_name },
    { key: 'checksum', label: 'SHA-256 checksum', value: doc.current_version?.checksum },
  ];
};

export const extractDocumentMetadataPayload = (document?: Document | null): DocumentMetadataPayload | null => {
  const metadata = document?.['metadata'] as DocumentMetadataPayload | undefined;
  if (!metadata) {
    return null;
  }
  const keys = Object.keys(metadata);
  if (!keys.length) {
    return null;
  }
  return metadata;
};
