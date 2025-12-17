import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_FIELD,
  SORT_FIELD_VALUES,
} from './workspaceUtils';
import {
  INCLUDE_DESCENDANTS_STORAGE_KEY,
  SORT_DIRECTION_STORAGE_KEY,
  SORT_FIELD_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
} from '../constants/workspace';

const readSessionStorage = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key);
  } catch (error) {
    console.warn(`[session-storage] failed to read ${key}`, error);
    return null;
  }
};

const writeSessionStorage = (key: string, value: string): void => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[session-storage] failed to persist ${key}`, error);
  }
};

export const useDocumentsPreferences = () => {
  const [documentsViewMode, setDocumentsViewModeState] = useState<'list' | 'grid' | 'desk'>(() => {
    const stored = readSessionStorage(VIEW_MODE_STORAGE_KEY);
    if (stored === 'grid' || stored === 'desk') {
      return stored;
    }
    return 'list';
  });

  const lastNonDeskViewRef = useRef<'list' | 'grid'>((documentsViewMode === 'desk' ? 'list' : documentsViewMode) as 'list' | 'grid');

  const setDocumentsViewMode = useCallback((mode: string) => {
    const next = mode === 'grid' ? 'grid' : mode === 'desk' ? 'desk' : 'list';
    setDocumentsViewModeState((previous) => {
      if (next !== previous) {
        writeSessionStorage(VIEW_MODE_STORAGE_KEY, next);
      }
      return next;
    });
  }, []);

  const handleDeskExit = useCallback(() => {
    const fallback = lastNonDeskViewRef.current && lastNonDeskViewRef.current !== 'desk'
      ? lastNonDeskViewRef.current
      : 'list';
    setDocumentsViewMode(fallback);
  }, [setDocumentsViewMode]);

  const [documentsSortField, setDocumentsSortField] = useState(() => {
    const stored = readSessionStorage(SORT_FIELD_STORAGE_KEY);
    return SORT_FIELD_VALUES.includes(stored) ? stored : DEFAULT_SORT_FIELD;
  });
  useEffect(() => {
    writeSessionStorage(SORT_FIELD_STORAGE_KEY, documentsSortField);
  }, [documentsSortField]);

  const [documentsSortDirection, setDocumentsSortDirection] = useState(() => {
    const stored = readSessionStorage(SORT_DIRECTION_STORAGE_KEY);
    return stored === 'desc' || stored === 'asc' ? stored : DEFAULT_SORT_DIRECTION;
  });

  useEffect(() => {
    writeSessionStorage(SORT_DIRECTION_STORAGE_KEY, documentsSortDirection);
  }, [documentsSortDirection]);

  const handleDocumentsSortFieldChange = useCallback((field: string) => {
    const nextField = SORT_FIELD_VALUES.includes(field) ? field : DEFAULT_SORT_FIELD;
    setDocumentsSortField((previous) => (previous === nextField ? previous : nextField));
  }, []);

  const handleDocumentsSortDirectionToggle = useCallback(() => {
    setDocumentsSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
  }, []);

  const [searchIncludeDescendants, setSearchIncludeDescendants] = useState(() => {
    const stored = readSessionStorage(INCLUDE_DESCENDANTS_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return true;
  });
  useEffect(() => {
    writeSessionStorage(
      INCLUDE_DESCENDANTS_STORAGE_KEY,
      searchIncludeDescendants ? 'true' : 'false',
    );
  }, [searchIncludeDescendants]);

  const toggleSearchIncludeDescendants = useCallback(() => {
    setSearchIncludeDescendants((previous) => !previous);
  }, []);

  return {
    documentsViewMode,
    handleDocumentsViewModeChange: setDocumentsViewMode,
    handleDeskExit,
    documentsSortField,
    documentsSortDirection,
    handleDocumentsSortFieldChange,
    handleDocumentsSortDirectionToggle,
    searchIncludeDescendants,
    setSearchIncludeDescendants,
    toggleSearchIncludeDescendants,
  };
};
