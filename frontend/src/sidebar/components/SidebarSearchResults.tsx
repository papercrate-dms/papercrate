import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../../utils/cx';
import { useDocumentsFilter } from '../../documents/context/DocumentsFilterContext';
import { useTags } from '../../lib/context/TagsContext';
import { useCorrespondents } from '../../lib/context/CorrespondentsContext';
import { useFolderTree } from '../../lib/context/FolderTreeContext';
import { useSearchPanel } from '../../documents/context/SearchPanelContext';
import { useDocumentOpen } from '../../lib/context/DocumentOpenContext';
import { listDocuments } from '../../lib/api/apiClient';
import { getTagColorStyle } from '../../utils/colors';
import type { DocumentResponse } from '../../lib/api/apiTypes';
import type { FolderNodeId } from '../../types/identifiers';

const MAX_RESULTS_PER_TYPE = 8;

interface SearchResult {
  id: string;
  label: string;
  actionLabel: string;
  /** Called on select. Return true to close search. */
  onSelect: () => boolean;
  active?: boolean;
  className?: string;
  color?: string | null;
}

interface SearchResultGroupProps {
  title: string;
  items: SearchResult[];
  startIndex: number;
  highlightIndex: number;
  onHighlight: (index: number) => void;
  onClose: () => void;
  className?: string;
}

const SearchResultGroup: React.FC<SearchResultGroupProps> = ({
  title,
  items,
  startIndex,
  highlightIndex,
  onHighlight,
  onClose,
  className,
}) => {
  if (items.length === 0) return null;
  return (
    <div className={cx('search-panel__group', className)}>
      {title && <div className="search-panel__group-label">{title}</div>}
      {items.map((item, i) => {
        const idx = startIndex + i;
        return (
          <button
            key={item.id}
            type="button"
            className={cx('search-panel__result', item.className, idx === highlightIndex && 'is-highlighted', item.active && 'is-active')}
            onClick={() => { if (item.onSelect()) onClose(); }}
            onMouseEnter={() => onHighlight(idx)}
          >
            <span className="search-panel__result-label">
              {item.color != null ? (
                <span className="badge tag-chip tag-chip--small" style={getTagColorStyle(item.color) || undefined}>{item.label}</span>
              ) : item.label}
            </span>
            <span className="search-panel__result-action">{item.actionLabel}</span>
          </button>
        );
      })}
    </div>
  );
};

function matchScore(label: string, query: string): number {
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  if (lower === q) return 3;
  if (lower.startsWith(q)) return 2;
  if (lower.includes(q)) return 1;
  return 0;
}

function filterAndSort<T>(items: T[], query: string, getLabel: (item: T) => string): T[] {
  const scored = items
    .map((item) => ({ item, score: matchScore(getLabel(item), query) }))
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS_PER_TYPE).map((s) => s.item);
}

interface SidebarSearchResultsProps {
  children: React.ReactNode;
}

const SidebarSearchResults: React.FC<SidebarSearchResultsProps> = ({ children }) => {
  const [query, setQuery] = useState('');
  const {
    setQuery: setFilterQuery,
    submit: submitFilter,
    toggleTag,
    toggleCorrespondent,
    activeTagIds,
    activeCorrespondentIds,
  } = useDocumentsFilter();
  const { tags } = useTags();
  const { correspondents } = useCorrespondents();
  const { folderOptions, selectFolder } = useFolderTree();
  const { close: closeSearchPanel, inputRef } = useSearchPanel();
  const { openDocument } = useDocumentOpen();

  const [documentResults, setDocumentResults] = useState<DocumentResponse[]>([]);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= 2;

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Client-side results
  const folderMatches = useMemo(
    () => (hasQuery ? filterAndSort(folderOptions, trimmed, (f) => f.label) : []),
    [folderOptions, trimmed],
  );
  const tagMatches = useMemo(
    () => (hasQuery ? filterAndSort(tags, trimmed, (t) => t.label) : []),
    [tags, trimmed],
  );
  const correspondentMatches = useMemo(
    () => (hasQuery ? filterAndSort(correspondents, trimmed, (c) => c.name) : []),
    [correspondents, trimmed],
  );

  // Document search with debounce + AbortController
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!hasQuery) {
      setDocumentResults([]);
      setDocumentLoading(false);
      return;
    }
    const abort = new AbortController();
    setDocumentLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await listDocuments(
          { query: trimmed, sort: 'updated_at', dir: 'desc' },
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setDocumentResults(results.slice(0, MAX_RESULTS_PER_TYPE));
        }
      } catch {
        if (!abort.signal.aborted) setDocumentResults([]);
      } finally {
        if (!abort.signal.aborted) setDocumentLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      abort.abort();
    };
  }, [trimmed, hasQuery]);

  // Build grouped results — each item carries its own onSelect handler
  const folderResults: SearchResult[] = useMemo(
    () => folderMatches.map((f) => ({
      id: f.id as string,
      label: f.label,
      actionLabel: 'Open',
      onSelect: () => { selectFolder(f.id as FolderNodeId); return true; },
    })),
    [folderMatches, selectFolder],
  );
  const tagResults: SearchResult[] = useMemo(
    () => tagMatches.map((t) => {
      const active = activeTagIds.includes(t.id);
      return {
        id: t.id,
        label: t.label,
        color: t.color,
        actionLabel: active ? 'Remove filter' : 'Filter',
        active,
        onSelect: () => { toggleTag(t.id); return true; },
      };
    }),
    [tagMatches, activeTagIds, toggleTag],
  );
  const correspondentResults: SearchResult[] = useMemo(
    () => correspondentMatches.map((c) => {
      const active = activeCorrespondentIds.includes(c.id);
      return {
        id: c.id,
        label: c.name,
        actionLabel: active ? 'Remove filter' : 'Filter',
        active,
        onSelect: () => { toggleCorrespondent(c.id); return true; },
      };
    }),
    [correspondentMatches, activeCorrespondentIds, toggleCorrespondent],
  );
  const docResults: SearchResult[] = useMemo(
    () => documentResults.map((d) => ({
      id: d.id,
      label: d.title || d.id,
      actionLabel: 'Open',
      onSelect: () => { openDocument(d, 'inspect'); return false; },
    })),
    [documentResults, openDocument],
  );
  const searchAllResult: SearchResult[] = useMemo(
    () => hasQuery ? [{
      id: 'search-all',
      label: `Search all documents for \u201c${trimmed}\u201d`,
      actionLabel: '',
      className: 'search-panel__search-all',
      onSelect: () => { setFilterQuery(trimmed); submitFilter(); return true; },
    }] : [],
    [trimmed, setFilterQuery, submitFilter],
  );

  const { groups, allResults } = useMemo(() => {
    const groupDefs = [
      { title: 'Folders', items: folderResults },
      { title: 'Tags', items: tagResults },
      { title: 'Correspondents', items: correspondentResults },
      { title: 'Documents', items: docResults },
      { title: '', items: searchAllResult, className: 'search-panel__group--footer' },
    ];
    let offset = 0;
    const grouped = groupDefs.map((g) => {
      const group = { ...g, startIndex: offset };
      offset += g.items.length;
      return group;
    });
    return { groups: grouped, allResults: groupDefs.flatMap((g) => g.items) };
  }, [folderResults, tagResults, correspondentResults, docResults, searchAllResult]);

  // Clamp highlight when results shrink
  useEffect(() => {
    setHighlightIndex((prev) =>
      prev >= allResults.length ? Math.max(allResults.length - 1, -1) : prev,
    );
  }, [allResults.length]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSearchPanel();
        return;
      }
      if (event.key === 'Enter' && !trimmed) {
        closeSearchPanel();
        return;
      }
      if (allResults.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightIndex((prev) => (prev + 1) % allResults.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightIndex((prev) => (prev <= 0 ? allResults.length - 1 : prev - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < allResults.length) {
          if (allResults[highlightIndex].onSelect()) closeSearchPanel();
        } else {
          setFilterQuery(trimmed);
          submitFilter();
          closeSearchPanel();
        }
      }
    },
    [allResults, highlightIndex, trimmed, setFilterQuery, submitFilter, closeSearchPanel],
  );

  const handleBlur = useCallback(() => {
    if (!query.trim()) {
      closeSearchPanel();
    }
  }, [query, closeSearchPanel]);

  return (
    <>
      <div className="search-field">
        <button
          type="button"
          className="search-field__clear"
          onClick={closeSearchPanel}
          aria-label="Close search"
          title="Close search"
        >
          &times;
        </button>
        <input
          ref={inputRef}
          type="text"
          className="search-field__input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlightIndex(-1); }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Search..."
          autoComplete="off"
        />
      </div>

      {hasQuery ? (
        <div className="search-panel__results">
          {groups.map((group, gi) => (
            <SearchResultGroup
              key={group.title || gi}
              title={group.title}
              items={group.items}
              startIndex={group.startIndex}
              highlightIndex={highlightIndex}
              onHighlight={setHighlightIndex}
              onClose={closeSearchPanel}
              className={group.className}
            />
          ))}

          {documentLoading && documentResults.length === 0 && (
            <div className="search-panel__loading">Searching documents...</div>
          )}
        </div>
      ) : (
        children
      )}
    </>
  );
};

export default SidebarSearchResults;
