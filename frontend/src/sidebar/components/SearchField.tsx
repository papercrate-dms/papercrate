import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDocumentsFilter } from '../../documents/context/DocumentsFilterContext';
import { useHotkey } from '../../hooks/useHotkey';

const SearchField: React.FC = () => {
  const { query: filterQuery, setQuery: setFilterQuery, submit: submitFilter, clear: clearFilter } = useDocumentsFilter();

  const [localQuery, setLocalQuery] = useState(filterQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalQuery(filterQuery);
  }, [filterQuery]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQuery(event.target.value);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      setFilterQuery(localQuery.trim());
      submitFilter();
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      setLocalQuery(filterQuery);
      inputRef.current?.blur();
    }
  }, [localQuery, filterQuery, setFilterQuery, submitFilter]);

  const handleClear = useCallback(() => {
    clearFilter();
    setLocalQuery('');
  }, [clearFilter]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useHotkey('/', focusInput);
  useHotkey('k', focusInput, { meta: true });

  return (
    <div className="search-field">
      <button
        type="button"
        className="search-field__clear"
        onClick={handleClear}
        aria-label="Clear all filters"
        title="Clear all filters"
      >
        &times;
      </button>
      <input
        ref={inputRef}
        type="search"
        className="search-field__input"
        value={localQuery}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Search documents..."
        aria-label="Search documents"
      />
    </div>
  );
};

export default SearchField;
