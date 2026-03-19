import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../lib/store/appState';
import { TAG_FILTER_UNTAGGED } from './workspaceUtils';
import { listDocuments } from '../lib/api/apiClient';
import type { Identifier } from '../types/identifiers';

import type { Document } from '../types/documents';

type ApiClient = {
  get: <T = unknown>(url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: T }>;
};

import useNotifyApiError from '../hooks/useNotifyApiError';

interface UseDocumentsSearchArgs {
  api: ApiClient;
  selectedFolder?: Identifier | 'root' | null;
  locationPathname?: string;
  isWorkspaceRoute?: boolean;
  searchIncludeDescendants?: boolean;
  documentsSortField?: string;
  documentsSortDirection?: string;
  setSearchIncludeDescendants: (value: boolean) => void;
  documentsManager: {
    ingest: (docs: unknown[]) => { canonical: Document[]; changed: boolean };
  };
}

interface UseDocumentsSearchResult {
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchResultIds: Identifier[] | null;
  setSearchResultIds: Dispatch<SetStateAction<Identifier[] | null>>;
  searchLoading: boolean;
  setSearchLoading: Dispatch<SetStateAction<boolean>>;
  activeTagFilters: Identifier[];
  setActiveTagFilters: Dispatch<SetStateAction<Identifier[]>>;
  activeCorrespondentFilters: Identifier[];
  setActiveCorrespondentFilters: Dispatch<SetStateAction<Identifier[]>>;
  toggleTagFilter: (tagId: Identifier) => void;
  toggleCorrespondentFilter: (correspondentId?: Identifier | null) => void;
  isFilterActive: boolean;
  clearFilters: () => void;
  handleSearchChange: (value: string) => void;
  handleSearchSubmit: () => void;
  refetchSearchResults: () => void;
  documentsFilterValue: {
    query: string;
    searchResultIds: Identifier[] | null;
    searchLoading: boolean;
    includeDescendants: boolean;
    activeTagIds: Identifier[];
    activeCorrespondentIds: Identifier[];
    isActive: boolean;
    setQuery: (value: string) => void;
    submit: () => void;
    clear: () => void;
    toggleTag: (tagId: Identifier) => void;
    toggleCorrespondent: (correspondentId?: Identifier | null) => void;
    toggleIncludeDescendants: () => void;
  };
}

const useDocumentsSearch = ({
  api,
  selectedFolder,
  locationPathname,
  isWorkspaceRoute,
  searchIncludeDescendants,
  documentsSortField,
  documentsSortDirection,
  setSearchIncludeDescendants,
  documentsManager,
}: UseDocumentsSearchArgs): UseDocumentsSearchResult => {
  const { token } = useAppState();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTagFilters, setActiveTagFilters] = useState<Identifier[]>([]);
  const [activeCorrespondentFilters, setActiveCorrespondentFilters] = useState<Identifier[]>([]);
  const [searchResultIds, setSearchResultIds] = useState<Identifier[] | null>(null);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchTrigger, setSearchTrigger] = useState<number>(0);
  const notifyApiError = useNotifyApiError();
  const navigate = useNavigate();

  const toggleTagFilter = useCallback((tagId: Identifier) => {
    if (!tagId) return;
    setActiveTagFilters((previous) => {
      if (tagId === TAG_FILTER_UNTAGGED) {
        return previous.includes(TAG_FILTER_UNTAGGED) ? [] : [TAG_FILTER_UNTAGGED];
      }
      const sanitized = previous.filter((id) => id !== TAG_FILTER_UNTAGGED);
      if (sanitized.includes(tagId)) {
        return sanitized.filter((id) => id !== tagId);
      }
      return sanitized.concat([tagId]);
    });
  }, []);

  const toggleCorrespondentFilter = useCallback((correspondentId?: Identifier | null) => {
    setActiveCorrespondentFilters((previous) => {
      if (!correspondentId) {
        return [];
      }
      return previous.includes(correspondentId) ? [] : [correspondentId];
    });
  }, []);

  const isFilterActive = useMemo(
    () =>
      searchQuery.trim().length > 0
      || activeTagFilters.length > 0
      || activeCorrespondentFilters.length > 0,
    [searchQuery, activeTagFilters, activeCorrespondentFilters],
  );

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setActiveTagFilters([]);
    setActiveCorrespondentFilters([]);
    setSearchLoading(false);
    setSearchIncludeDescendants(true);
    setSearchResultIds(null);
  }, [
    setSearchIncludeDescendants,
  ]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleSearchSubmit = useCallback(() => {
    if (!navigate) return;
    const targetFolder = selectedFolder && selectedFolder !== 'root' ? selectedFolder : 'root';
    const targetPath = targetFolder === 'root' ? '/folders' : `/folders/${targetFolder}`;
    if (!isWorkspaceRoute || locationPathname !== targetPath) {
      navigate(targetPath, { replace: false });
    }
  }, [navigate, selectedFolder, isWorkspaceRoute, locationPathname]);

  const documentsFilterValue = useMemo(
    () => ({
      query: searchQuery,
      searchResultIds,
      searchLoading,
      includeDescendants: Boolean(searchIncludeDescendants),
      activeTagIds: activeTagFilters,
      activeCorrespondentIds: activeCorrespondentFilters,
      isActive: isFilterActive,
      setQuery: handleSearchChange,
      submit: handleSearchSubmit,
      clear: clearFilters,
      toggleTag: toggleTagFilter,
      toggleCorrespondent: toggleCorrespondentFilter,
      toggleIncludeDescendants: () => setSearchIncludeDescendants(!searchIncludeDescendants),
    }),
    [
      searchQuery,
      searchResultIds,
      searchLoading,
      searchIncludeDescendants,
      activeTagFilters,
      activeCorrespondentFilters,
      isFilterActive,
      handleSearchChange,
      handleSearchSubmit,
      clearFilters,
      toggleTagFilter,
      toggleCorrespondentFilter,
      setSearchIncludeDescendants,
    ],
  );

  const refetchSearchResults = useCallback(() => {
    setSearchTrigger(Date.now());
  }, []);

  useEffect(() => {
    if (!token) return undefined;

    if (!isFilterActive) {
      setSearchResultIds(null);
      setSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    let started = false;
    setSearchLoading(true);

    const debounce = setTimeout(async () => {
      started = true;
      try {
        const params: Record<string, unknown> = {};
        const trimmedQuery = searchQuery.trim();
        if (trimmedQuery.length) {
          params.query = trimmedQuery;
        }
        if (activeTagFilters.length) {
          const onlyUntagged = activeTagFilters.length === 1
            && activeTagFilters[0] === TAG_FILTER_UNTAGGED;
          if (onlyUntagged) {
            params.tags = 'none';
          } else {
            const tagIds = activeTagFilters.filter((id) => id !== TAG_FILTER_UNTAGGED);
            if (tagIds.length) {
              params.tags = tagIds.join(',');
            }
          }
        }
        if (activeCorrespondentFilters.length) {
          params.correspondents = activeCorrespondentFilters.join(',');
        }
        const folderIdentifier = selectedFolder === 'root' ? null : selectedFolder;
        if (folderIdentifier) {
          params.folder_id = folderIdentifier;
        }
        if (!searchIncludeDescendants) {
          params.include_descendants = false;
        }
        if (documentsSortField) {
          params.sort = documentsSortField;
        }
        if (documentsSortDirection) {
          params.dir = documentsSortDirection;
        }
        const data = await listDocuments(params);
        if (cancelled) return;

        const results = Array.isArray(data) ? data : [];
        const { canonical } = documentsManager.ingest(results);
        const ids = canonical
          .map((doc) => (doc?.id ?? null) as Identifier | null)
          .filter((id): id is Identifier => id != null);
        setSearchResultIds(ids);

        if (!ids.length) {
          setSearchLoading(false);
          return;
        }
      } catch (error) {
        if (cancelled) return;
        notifyApiError(error, 'Search failed. Please try again.');
        setSearchResultIds(null);
      } finally {
        if (!cancelled && started) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (started) {
        setSearchLoading(false);
      }
    };
  }, [
    api,
    token,
    isFilterActive,
    searchQuery,
    activeTagFilters,
    activeCorrespondentFilters,
    searchIncludeDescendants,
    documentsSortField,
    documentsSortDirection,
    selectedFolder,
    notifyApiError,
    documentsManager,
    searchTrigger,
  ]);

  return {
    searchQuery,
    setSearchQuery,
    searchResultIds,
    setSearchResultIds,
    searchLoading,
    setSearchLoading,
    activeTagFilters,
    setActiveTagFilters,
    activeCorrespondentFilters,
    setActiveCorrespondentFilters,
    toggleTagFilter,
    toggleCorrespondentFilter,
    isFilterActive,
    clearFilters,
    handleSearchChange,
    handleSearchSubmit,
    refetchSearchResults,
    documentsFilterValue,
  };
};

export default useDocumentsSearch;
