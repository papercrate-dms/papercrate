import React, { useCallback } from 'react';
import { useDocumentsFilter } from '../../documents/context/DocumentsFilterContext';

const SidebarSearch: React.FC = () => {
    const {
        query: searchQuery,
        isActive: isFilterActive,
        setQuery: setFilterQuery,
        submit: submitFilter,
        clear: clearFilterState,
    } = useDocumentsFilter();

    const handleSearchInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            setFilterQuery(event.target.value);
        },
        [setFilterQuery],
    );

    const handleSearchFormSubmit = useCallback(
        (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submitFilter();
        },
        [submitFilter],
    );

    const handleSearchClear = useCallback(() => {
        clearFilterState();
    }, [clearFilterState]);

    return (
        <form className="sidebar__search" onSubmit={handleSearchFormSubmit}>
            <input
                type="search"
                value={searchQuery}
                onChange={handleSearchInputChange}
                placeholder="Search documents"
                aria-label="Search documents"
            />
            {isFilterActive && (
                <button type="button" onClick={handleSearchClear}>
                    Clear
                </button>
            )}
        </form>
    );
};

export default SidebarSearch;

