import React from 'react';
import type { JSX } from 'react';
import {
  ViewListIcon,
  ViewGridIcon,
  IconFileStack,
  RefreshIcon,
  FoldersIcon,
  FoldersOffIcon,
  SortAscendingLettersIcon,
  SortDescendingLettersIcon,
} from '../../components/icons';
import SortFieldQuickMenu from './SortFieldQuickMenu';
import { useDocumentsSearch } from '../../lib/context/DocumentsSearchContext';

type ViewMode = 'list' | 'grid' | 'desk' | (string & {});
type SortDirection = 'asc' | 'desc' | (string & {});

const VIEW_MODES: Array<{ mode: ViewMode; label: string; Icon: React.FC<{ className?: string; size?: number }> }> = [
  { mode: 'list', label: 'List view', Icon: ViewListIcon },
  { mode: 'grid', label: 'Icons view', Icon: ViewGridIcon },
  { mode: 'desk', label: 'Desk view', Icon: IconFileStack },
];

const ViewModeToggle: React.FC = () => {
  const { documentsViewMode, handleDocumentsViewModeChange } = useDocumentsSearch();
  return (
    <div className="view-toggle" role="group" aria-label="Change view">
      {VIEW_MODES.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          className={`toggle-button${documentsViewMode === mode ? ' active' : ''}`}
          onClick={() => handleDocumentsViewModeChange(mode)}
          aria-pressed={documentsViewMode === mode}
          title={label}
        >
          <Icon className="view-toggle__icon" size={18} />
        </button>
      ))}
    </div>
  );
};

export interface SortConfig {
  field: string;
  direction: SortDirection;
  onFieldChange: (field: string) => void;
  onDirectionToggle: () => void;
}

interface DocumentsTableHeaderActionOptions {
  onRefresh: () => void;
  sort?: SortConfig | null;
  isFilterActive?: boolean;
  includeDescendants?: boolean;
  onToggleIncludeDescendants?: () => void;
}

export const createDocumentsTableHeaderActions = ({
  onRefresh,
  sort,
  isFilterActive = false,
  includeDescendants = true,
  onToggleIncludeDescendants,
}: DocumentsTableHeaderActionOptions): JSX.Element => {
  const sortField = sort?.field ?? 'title';
  const sortDirection = sort?.direction ?? 'asc';
  const onSortFieldChange = sort?.onFieldChange;
  const onSortDirectionToggle = sort?.onDirectionToggle;
  const sortDirectionIsDesc = sortDirection === 'desc';
  const sortDirectionTitle = sortDirectionIsDesc
    ? 'Sorting Z → A. Click to switch to ascending.'
    : 'Sorting A → Z. Click to switch to descending.';

  const includeDescendantsToggle = isFilterActive && onToggleIncludeDescendants
    ? (
      <button
        type="button"
        className="icon-button documents-toolbar__toggle"
        onClick={onToggleIncludeDescendants}
        aria-pressed={!includeDescendants}
        aria-label={includeDescendants ? 'Include subfolders' : 'Limit to current folder'}
        title={includeDescendants
          ? 'Including subfolders. Click to limit the search to the current folder.'
          : 'Limiting to the current folder. Click to include subfolders again.'}
      >
        {includeDescendants ? <FoldersIcon /> : <FoldersOffIcon />}
      </button>
    )
    : null;

  const sortControls = onSortFieldChange
    ? (
      <div className="documents-actions__sort-group">
        <SortFieldQuickMenu sortField={sortField} onChange={onSortFieldChange} />
        {onSortDirectionToggle ? (
          <button
            type="button"
            className="icon-button documents-toolbar__toggle documents-sort__direction"
            onClick={onSortDirectionToggle}
            aria-pressed={sortDirectionIsDesc}
            aria-label={sortDirectionIsDesc ? 'Sort descending' : 'Sort ascending'}
            title={sortDirectionTitle}
          >
            {sortDirectionIsDesc ? (
              <SortDescendingLettersIcon size={18} />
            ) : (
              <SortAscendingLettersIcon size={18} />
            )}
          </button>
        ) : null}
      </div>
    )
    : null;

  return (
    <>
      {includeDescendantsToggle ? (
        <>
          {includeDescendantsToggle}
          <span className="actions-divider" aria-hidden="true" />
        </>
      ) : null}
      {sortControls ? (
        <>
          {sortControls}
          <span className="actions-divider" aria-hidden="true" />
        </>
      ) : null}
      <ViewModeToggle />
      <span className="actions-divider" aria-hidden="true" />
      <button
        type="button"
        className="icon-button"
        onClick={onRefresh}
        aria-label="Refresh"
        title="Refresh"
      >
        <RefreshIcon />
      </button>
    </>
  );
};
