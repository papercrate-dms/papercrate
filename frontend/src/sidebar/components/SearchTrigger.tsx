import React from 'react';
import { useSearchPanel } from '../../documents/context/SearchPanelContext';
import { useHotkey } from '../../hooks/useHotkey';
import { SearchIcon } from '../../components/icons';

const SearchTrigger: React.FC = () => {
  const { toggle } = useSearchPanel();

  useHotkey('/', toggle);
  useHotkey('k', toggle, { meta: true });

  return (
    <button
      type="button"
      className="search-trigger"
      onClick={toggle}
      aria-label="Search everything"
    >
      <SearchIcon className="search-trigger__icon" />
      <span className="search-trigger__text">Search</span>
      <kbd className="search-trigger__shortcut">/</kbd>
    </button>
  );
};

export default SearchTrigger;
