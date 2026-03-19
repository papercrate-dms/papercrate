import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EditIcon, IconX, PlusIcon } from '../../components/icons';
import InlineRenameInput from '../../documents/components/InlineRenameInput';
import SelectionAssignmentMenu, {
  SelectionAssignmentMenuItem,
  type NormalizedSelectionAssignmentItem,
} from '../../documents/features/selection/SelectionAssignmentMenu';
import { getTagColorStyle } from '../../utils/colors';
import {
  formatDate,
  toDateInputValue,
  toIssuedTimestamp,
} from '../../utils/date';
import { describeDocumentSummary, type DocumentSummaryRow } from '../logic/documentSummary';

import { useFolderManager } from '../../folders/FolderManagerContext';
import { resolveTags, resolveCorrespondentIds } from '../../utils/resolveAssets';
import { useTags } from '../../lib/context/TagsContext';
import { useCorrespondents } from '../../lib/context/CorrespondentsContext';
import type { Document, Tag, Correspondent } from '../../types/documents';
import type { FolderId, Identifier, TagId } from '../../types/identifiers';

interface TagSectionProps {
  tags?: Tag[];
  onRemove?: (tag: Tag) => void;
  onAdd?: (payload: { value: string; option?: unknown; input?: unknown }) => void;
  emptyMessage?: string;
  addPlaceholder?: string;
  addButtonLabel?: string;
  datalistOptions?: Array<SelectionAssignmentMenuItem | string>;
  className?: string;
}

interface CorrespondentSectionProps {
  entries?: Correspondent[];
  onRemove?: (entry: Correspondent) => void;
  onAdd?: (payload: { name: string; option?: unknown; input?: unknown }) => void;
  showCount?: boolean;
  addPlaceholder?: string;
  addButtonLabel?: string;
  datalistOptions?: Array<SelectionAssignmentMenuItem | string>;
  className?: string;
}

export interface DocumentSummarySectionProps {
  document?: Document | null;
  tagOptions?: SelectionAssignmentMenuItem[];
  onTagAdd?: (doc: Document, value: string, context?: { option?: unknown }) => void;
  onTagRemove?: (docId: Identifier | undefined, tagId: TagId | undefined) => void;
  correspondentOptions?: SelectionAssignmentMenuItem[];
  onCorrespondentAdd?: (payload: { document: Document; name: string; option?: unknown }) => void;
  onCorrespondentRemove?: (payload: { documentId: Identifier | undefined; correspondentId: Identifier | undefined }) => void;
  onUpdateTitle?: (docId: Identifier | undefined, title: string) => Promise<boolean> | boolean;
  onUpdateIssued?: (docId: Identifier | undefined, timestamp: number | null) => Promise<boolean> | boolean;
  onFolderNavigate?: (folderId: FolderId | null) => void;
  layout?: 'default' | 'compact';
}

interface MetaItem {
  key: string;
  label: string;
  valueContent?: React.ReactNode | null;
  fallbackValue?: string | null;
  error?: string | null;
}

export const sortCorrespondents = (entries: Correspondent[] = []) =>
  entries
    .filter((entry) => entry && entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));

export const buildCorrespondentOptions = (entries = []) => {
  const seen = new Set();
  return entries.reduce((options, entry) => {
    const name = entry?.name?.trim?.() || '';
    if (!name) {
      return options;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return options;
    }
    seen.add(key);
    options.push(name);
    return options;
  }, []);
};

const normalizeOptions = <T,>(options?: T[] | null): T[] => (Array.isArray(options) ? options : []);

interface QuickAddOption {
  id?: Identifier;
  label?: string;
  name?: string;
  [key: string]: unknown;
}

interface QuickAddEntry {
  id: Identifier | string;
  label: string;
  original: QuickAddOption | string;
}

const resolveOptionName = (source?: QuickAddOption | string | null): string => {
  if (!source) {
    return '';
  }
  if (typeof source === 'string') {
    return source.trim();
  }
  const raw = source.name ?? source.label ?? '';
  return `${raw}`.trim();
};

const normalizeQuickAddOption = (option?: QuickAddOption | string | null): QuickAddEntry | null => {
  if (option == null) {
    return null;
  }
  const label = (() => {
    if (typeof option === 'string') {
      return option.trim();
    }
    const sourceLabel = option.label ?? option.name ?? '';
    return `${sourceLabel}`.trim();
  })();
  if (!label) {
    return null;
  }
  return {
    id: typeof option !== 'string' && option.id ? option.id : label,
    label,
    original: option,
  };
};

const TagSection: React.FC<TagSectionProps> = ({
  tags = [],
  onRemove,
  onAdd,
  emptyMessage = 'No tags yet.',
  addPlaceholder = 'Add or create tag',
  addButtonLabel = 'Add',
  datalistOptions = [],
  className,
}) => {
  const handleCreate = useCallback(
    (label: string) => onAdd?.({ value: label, input: null }),
    [onAdd],
  );

  const handleSelect = useCallback(
    (option: { label?: string; name?: string } | string | null) => {
      if (!onAdd) return;
      const label = resolveOptionName(option as QuickAddOption | string | null);
      if (!label) {
        return;
      }
      onAdd({ value: label, option });
    },
    [onAdd],
  );

  const normalizedOptions = useMemo(
    () =>
      normalizeOptions(datalistOptions)
        .map((option) => normalizeQuickAddOption(option))
        .filter((option): option is QuickAddEntry => Boolean(option)),
    [datalistOptions],
  );
  const containerClass = className ? `tag-list ${className}` : 'tag-list';
  const showQuickAdd = Boolean(onAdd);

  const assignmentItems = useMemo<SelectionAssignmentMenuItem[]>(() => {
    const map = new Map<string, SelectionAssignmentMenuItem>();

    normalizedOptions.forEach((option) => {
      const label = option?.label?.trim();
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      if (map.has(key)) {
        return;
      }
      map.set(key, {
        id: option.id ?? label,
        label,
        state: 'none',
        payload: option.original ?? { label },
      });
    });

    tags.forEach((tag) => {
      const label = tag?.label?.trim?.() || '';
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      const payload = { id: tag.id, label, color: tag.color ?? null };
      if (map.has(key)) {
        const entry = map.get(key);
        if (entry) {
          entry.state = 'all';
          entry.payload = payload;
        }
        return;
      }
      map.set(key, {
        id: tag.id ?? label,
        label,
        state: 'all',
        payload,
      });
    });

    return Array.from(map.values());
  }, [normalizedOptions, tags]);

  const handleAssignmentSelect = useCallback(
    (item: NormalizedSelectionAssignmentItem) => {
      if (!item) {
        return;
      }
      if (item.state === 'all' && onRemove) {
        const payload = item.payload && typeof item.payload === 'object' && 'id' in item.payload
          ? (item.payload as Tag)
          : tags.find((tag) => (tag.id ?? tag.label) === item.id) ?? { id: item.id, label: item.label } as unknown as Tag;
        onRemove(payload);
        return;
      }
      const payload = item.payload ?? { label: item.label };
      handleSelect(payload);
    },
    [handleSelect, onRemove, tags],
  );

  return (
    <div className={containerClass}>
      {tags.map((tag) => {
        const key = tag.id ?? tag.label;
        const style = getTagColorStyle(tag.color);
        return (
          <span key={key} className="badge tag-chip" style={style || undefined}>
            <span className="tag-chip__label">{tag.label}</span>
            {onRemove ? (
              <button
                type="button"
                className="tag-chip__remove"
                onClick={() => onRemove(tag)}
                aria-label={`Remove tag ${tag.label}`}
              >
                <IconX className="icon-inline" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        );
      })}
      {showQuickAdd ? (
        <SelectionAssignmentMenu
          label="Add tag"
          items={assignmentItems}
          placeholder={addPlaceholder}
          emptyMessage="No tags"
          createLabel={addButtonLabel}
          onToggle={handleAssignmentSelect}
          onCreate={handleCreate}
          showStateIndicators
          showCounts={false}
          positionStrategy="fixed"
          triggerClassName="quick-add__chip quick-add__trigger"
          triggerContent={<PlusIcon className="icon-inline" aria-hidden="true" />}
          closeOnSelection={false}
          freezeSortOnOpen
        />
      ) : null}
      {!tags.length && !showQuickAdd ? <span className="tag-list__empty meta">{emptyMessage}</span> : null}
    </div>
  );
};

const CorrespondentSection: React.FC<CorrespondentSectionProps> = ({
  entries = [],
  onRemove,
  onAdd,
  showCount = false,
  addPlaceholder = 'Add or create correspondent',
  addButtonLabel = 'Add',
  datalistOptions = [],
  className,
}) => {
  const handleCreate = useCallback(
    (name: string) => onAdd?.({ name, input: null }),
    [onAdd],
  );

  const normalizedOptions = useMemo(
    () =>
      normalizeOptions(datalistOptions)
        .map((option) => normalizeQuickAddOption(option))
        .filter((option): option is QuickAddEntry => Boolean(option)),
    [datalistOptions],
  );
  const hasEntries = entries && entries.length > 0;
  const showQuickAdd = Boolean(onAdd);
  const containerClass = className ? `correspondent-list ${className}` : 'correspondent-list';

  const assignmentItems = useMemo<SelectionAssignmentMenuItem[]>(() => {
    const map = new Map<string, SelectionAssignmentMenuItem>();

    normalizedOptions.forEach((option) => {
      const label = option?.label?.trim();
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      if (map.has(key)) {
        return;
      }
      map.set(key, {
        id: option.id ?? label,
        label,
        state: 'none',
        payload: option.original ?? { name: label },
      });
    });

    entries.forEach((entry) => {
      const label = entry?.name?.trim?.() || '';
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      const payload = entry;
      if (map.has(key)) {
        const item = map.get(key);
        if (item) {
          item.state = 'all';
          item.payload = payload;
        }
        return;
      }
      map.set(key, {
        id: entry.id ?? label,
        label,
        state: 'all',
        payload,
      });
    });

    return Array.from(map.values());
  }, [normalizedOptions, entries]);

  const handleAssignmentSelect = useCallback(
    (item: NormalizedSelectionAssignmentItem) => {
      if (!item) {
        return;
      }
      if (item.state === 'all' && onRemove) {
        const payload = (item.payload || { id: item.id, name: item.label }) as Correspondent;
        onRemove(payload);
        return;
      }
      if (!onAdd) {
        return;
      }
      const source = (item.payload ?? item) as QuickAddOption | string | null;
      const resolvedName = resolveOptionName(source);
      if (!resolvedName) {
        return;
      }
      const payload = typeof source !== 'string'
        ? { ...source, name: resolvedName }
        : { id: null, name: resolvedName };
      onAdd({ name: resolvedName, option: payload, input: null });
    },
    [onAdd, onRemove],
  );

  return (
    <div className={containerClass}>
      {hasEntries
        ? entries.map((entry) => {
          const key = entry.id ?? entry.name;
          return (
            <span key={key} className="correspondent-pill">
              <span className="correspondent-pill__label">
                {entry.name}
                {showCount && entry.usage_count ? ` (${entry.usage_count})` : ''}
              </span>
              {onRemove ? (
                <button
                  type="button"
                  className="correspondent-pill__remove"
                  onClick={() => onRemove(entry)}
                  aria-label={`Remove ${entry.name}`}
                >
                  <IconX className="icon-inline" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          );
        })
        : !showQuickAdd && <span className="meta">No correspondents yet.</span>}
      {showQuickAdd ? (
        <SelectionAssignmentMenu
          label="Add correspondent"
          items={assignmentItems}
          placeholder={addPlaceholder}
          emptyMessage="No correspondents"
          createLabel={addButtonLabel}
          onToggle={handleAssignmentSelect}
          onCreate={handleCreate}
          showStateIndicators
          showCounts={false}
          positionStrategy="fixed"
          triggerClassName="quick-add__chip quick-add__trigger"
          triggerContent={<PlusIcon className="icon-inline" aria-hidden="true" />}
          closeOnSelection={false}
          freezeSortOnOpen
        />
      ) : null}
    </div>
  );
};

const DocumentSummarySection: React.FC<DocumentSummarySectionProps> = ({
  document,
  tagOptions = [],
  onTagAdd,
  onTagRemove,
  correspondentOptions = [],
  onCorrespondentAdd,
  onCorrespondentRemove,
  onUpdateTitle,
  onUpdateIssued,
  onFolderNavigate,
  layout = 'default',
}) => {
  const folderManager = useFolderManager();
  const { tagLookupById } = useTags();
  const { correspondentLookupById } = useCorrespondents();
  const isCompactLayout = layout === 'compact';
  const summaryRows = useMemo(() => describeDocumentSummary(document, { tagLookupById }), [document, tagLookupById]);
  const issuedDateLabel = useMemo(
    () => formatDate(document?.issued_at, { fallback: null }),
    [document?.issued_at],
  );

  const editableTitle = Boolean(document && onUpdateTitle);
  const editableIssued = Boolean(document && onUpdateIssued);

  const resolvedTags = useMemo(
    () => resolveTags(document?.tags, tagLookupById),
    [document?.tags, tagLookupById],
  );

  const resolvedCorrespondents = useMemo(
    () => resolveCorrespondentIds(document?.correspondents, correspondentLookupById),
    [document?.correspondents, correspondentLookupById],
  );

  const extraSummaryRows = useMemo(() => {
    const rows: DocumentSummaryRow[] = [];
    const currentVersionNumber = document?.current_version?.version_number;
    if (currentVersionNumber != null) {
      rows.push({
        key: 'current-version',
        label: 'Current version',
        value: `#${currentVersionNumber}`,
      });
    }
    return rows;
  }, [document?.current_version?.version_number]);

  const resolvedFolderId = document?.folder_id ?? null;

  const [folderName, setFolderName] = useState<string | null>(() => folderManager.getNameSync(resolvedFolderId));

  useEffect(() => {
    let active = true;
    const cached = folderManager.getNameSync(resolvedFolderId);
    setFolderName(cached);
    if (!cached && resolvedFolderId != null) {
      folderManager.resolveName(resolvedFolderId).then((name) => {
        if (active) {
          setFolderName(name);
        }
      }).catch(() => { });
    }
    return () => {
      active = false;
    };
  }, [resolvedFolderId, folderManager]);

  const folderHref = resolvedFolderId == null ? '/folders' : `/folders/${resolvedFolderId}`;

  const handleFolderClick = useCallback(
    (event: React.MouseEvent) => {
      if (!onFolderNavigate) {
        return;
      }
      event.preventDefault();
      onFolderNavigate(resolvedFolderId);
    },
    [onFolderNavigate, resolvedFolderId],
  );

  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);

  const [issuedDraft, setIssuedDraft] = useState('');
  const [issuedSaving, setIssuedSaving] = useState(false);
  const [issuedError, setIssuedError] = useState(null);
  const [isIssuedEditing, setIsIssuedEditing] = useState(false);

  useEffect(() => {
    setIsTitleEditing(false);
    setTitleDraft('');
    setTitleError(null);
    setTitleSaving(false);

    setIsIssuedEditing(false);
    setIssuedDraft('');
    setIssuedError(null);
    setIssuedSaving(false);
  }, [document?.id]);

  const startTitleEdit = useCallback(() => {
    if (!editableTitle || !document) return;
    setIsTitleEditing(true);
    setTitleDraft(document.title || '');
    setTitleError(null);
  }, [document, editableTitle]);

  const cancelTitleEdit = useCallback(() => {
    setIsTitleEditing(false);
    setTitleDraft('');
    setTitleError(null);
    setTitleSaving(false);
  }, []);

  const submitTitleEdit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editableTitle || !document || !onUpdateTitle) return;
      const trimmed = titleDraft.trim();
      if (!trimmed) {
        setTitleError('Title cannot be empty.');
        return;
      }
      setTitleSaving(true);
      try {
        const ok = await onUpdateTitle(document.id, trimmed);
        if (ok) {
          cancelTitleEdit();
        } else {
          setTitleError('Failed to update title.');
        }
      } finally {
        setTitleSaving(false);
      }
    },
    [cancelTitleEdit, document, editableTitle, onUpdateTitle, titleDraft],
  );

  const startIssuedEdit = useCallback(() => {
    if (!editableIssued || !document) return;
    setIsIssuedEditing(true);
    setIssuedDraft(toDateInputValue(document.issued_at));
    setIssuedError(null);
  }, [document, editableIssued]);

  const cancelIssuedEdit = useCallback(() => {
    setIsIssuedEditing(false);
    setIssuedDraft('');
    setIssuedError(null);
    setIssuedSaving(false);
  }, []);

  const submitIssuedEdit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editableIssued || !document || !onUpdateIssued) return;
      const normalizedValue = issuedDraft ? toIssuedTimestamp(issuedDraft, document.issued_at) : null;
      setIssuedSaving(true);
      try {
        const ok = await onUpdateIssued(document.id, normalizedValue);
        if (ok) {
          cancelIssuedEdit();
        } else {
          setIssuedError('Failed to update issued date.');
        }
      } finally {
        setIssuedSaving(false);
      }
    },
    [cancelIssuedEdit, document, editableIssued, issuedDraft, onUpdateIssued],
  );

  if (!document) {
    return null;
  }

  const renderTitleEditForm = (extraClassName?: string) => (
    <InlineRenameInput
      value={titleDraft}
      onChange={(value) => {
        setTitleDraft(value);
        if (titleError) {
          setTitleError(null);
        }
      }}
      onSubmit={() => submitTitleEdit({ preventDefault: () => { } } as any)}
      onCancel={cancelTitleEdit}
      isSaving={titleSaving}
      className={`doc-title-edit${extraClassName ? ` ${extraClassName}` : ''}`}
      aria-label="Document title"
      autoFocus
    />
  );

  const titleMetaDisplay = editableTitle && isTitleEditing
    ? renderTitleEditForm('doc-title-edit--inline')
    : (
      <>
        <span className="detail-meta__value">{document?.title}</span>
        {editableTitle ? (
          <button
            type="button"
            className="icon-button"
            onClick={startTitleEdit}
            aria-label="Edit title"
            title="Edit title"
          >
            <EditIcon className="icon-inline" />
          </button>
        ) : null}
      </>
    );

  const issuedDisplay = editableIssued && isIssuedEditing ? (
    <InlineRenameInput
      type="date"
      value={issuedDraft}
      onChange={(value) => {
        setIssuedDraft(value);
        if (issuedError) {
          setIssuedError(null);
        }
      }}
      onSubmit={() => submitIssuedEdit({ preventDefault: () => { } } as any)}
      onCancel={cancelIssuedEdit}
      isSaving={issuedSaving}
      className="doc-issued-edit"
      aria-label="Issued on"
    />
  ) : (
    <>
      <span className="detail-meta__value">{issuedDateLabel || 'Not set'}</span>
      {editableIssued ? (
        <button
          type="button"
          className="icon-button"
          onClick={startIssuedEdit}
          aria-label={issuedDateLabel ? 'Edit issued date' : 'Set issued date'}
          title={issuedDateLabel ? 'Edit issued date' : 'Set issued date'}
        >
          <EditIcon className="icon-inline" />
        </button>
      ) : null}
    </>
  );

  const tagsValueContent = (
    <TagSection
      tags={resolvedTags}
      onRemove={
        onTagRemove
          ? (tag) => onTagRemove(document.id, tag.id)
          : undefined
      }
      onAdd={
        onTagAdd
          ? ({ value, option }) => onTagAdd(document, value, { option })
          : undefined
      }
      datalistOptions={tagOptions}
      className="document-summary__tags"
    />
  );

  const correspondentsValueContent = (
    <CorrespondentSection
      entries={resolvedCorrespondents}
      onRemove={
        onCorrespondentRemove
          ? (entry) =>
            onCorrespondentRemove({
              documentId: document.id,
              correspondentId: entry.id,
            })
          : undefined
      }
      onAdd={
        onCorrespondentAdd
          ? ({ name, option }) =>
            onCorrespondentAdd({
              document,
              name,
              option,
            })
          : undefined
      }
      showCount
      datalistOptions={correspondentOptions}
      className="document-summary__correspondents"
    />
  );

  const folderValueContent = (
    <Link
      className="document-summary__folder-link"
      to={folderHref}
      onClick={handleFolderClick}
    >
      {folderName}
    </Link>
  );

  const summaryRowOverrides = {
    title: { valueContent: titleMetaDisplay, error: titleError },
    issued: { valueContent: issuedDisplay, error: issuedError },
    tags: { valueContent: tagsValueContent },
    correspondents: { valueContent: correspondentsValueContent },
    folder: { valueContent: folderValueContent },
  } as Record<string, { valueContent?: React.ReactNode | null; error?: string | null }>;

  const baseRows: MetaItem[] = [...summaryRows, ...extraSummaryRows].map((row) => {
    const overrides = summaryRowOverrides[row.key] || {};
    return {
      key: row.key,
      label: row.label,
      valueContent: overrides.valueContent ?? null,
      fallbackValue: overrides.valueContent ? row.value : row.value,
      error: overrides.error ?? null,
    };
  });

  const allRows = baseRows;
  const summaryClass = `document-summary${isCompactLayout ? ' document-summary--compact' : ''}`;
  const sectionClass = `document-summary__section document-summary__meta${isCompactLayout ? ' document-summary__meta--compact' : ''}`;
  const listClass = `document-summary__details-list${isCompactLayout ? ' document-summary__details-list--meta' : ''}`;

  return (
    <div className={summaryClass}>
      <section className={sectionClass}>
        <dl className={listClass}>
          {allRows.map((item) => (
            <div key={item.key} className="document-summary__details-row">
              <dt>{item.label}</dt>
              <dd>
                {item.valueContent != null && item.valueContent !== ''
                  ? item.valueContent
                  : item.fallbackValue || '—'}
              </dd>
              {item.error ? <div className="status-inline error">{item.error}</div> : null}
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};

export default DocumentSummarySection;
