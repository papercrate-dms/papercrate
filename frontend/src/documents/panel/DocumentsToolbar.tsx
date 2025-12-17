import type { JSX } from 'react';
import {
  ViewListIcon,
  ViewGridIcon,
  IconFileStack,
  RefreshIcon,
  MinusVerticalIcon,
  FoldersIcon,
  FoldersOffIcon,
  SortAscendingLettersIcon,
  SortDescendingLettersIcon,
} from '../../components/icons';
import SortFieldQuickMenu from './SortFieldQuickMenu';

type ViewMode = 'list' | 'grid' | 'desk' | (string & {});
type SortDirection = 'asc' | 'desc' | (string & {});

interface DocumentsTableHeaderActionOptions {
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onRefresh: () => void;
  sortField?: string;
  onSortFieldChange?: (field: string) => void;
  sortDirection?: SortDirection;
  onSortDirectionToggle?: () => void;
  isFilterActive?: boolean;
  includeDescendants?: boolean;
  onToggleIncludeDescendants?: () => void;
}

export const createDocumentsTableHeaderActions = ({
  viewMode = 'list',
  onViewModeChange,
  onRefresh,
  sortField = 'title',
  onSortFieldChange,
  sortDirection = 'asc',
  onSortDirectionToggle,
  isFilterActive = false,
  includeDescendants = true,
  onToggleIncludeDescendants,
}: DocumentsTableHeaderActionOptions): JSX.Element => {
  const isListView = viewMode === 'list';
  const isGridView = viewMode === 'grid';
  const isDeskView = viewMode === 'desk';

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
          <span className="main-content__actions-divider" aria-hidden="true">
            <MinusVerticalIcon />
          </span>
        </>
      ) : null}
      {sortControls ? (
        <>
          {sortControls}
          <span className="main-content__actions-divider" aria-hidden="true">
            <MinusVerticalIcon />
          </span>
        </>
      ) : null}
      <div className="view-toggle" role="group" aria-label="Change view">
        <button
          type="button"
          className={`toggle-button${isListView ? ' active' : ''}`}
          onClick={() => onViewModeChange?.('list')}
          aria-pressed={isListView}
          title="List view"
        >
          <ViewListIcon className="view-toggle__icon" size={18} />
        </button>
        <button
          type="button"
          className={`toggle-button${isGridView ? ' active' : ''}`}
          onClick={() => onViewModeChange?.('grid')}
          aria-pressed={isGridView}
          title="Icons view"
        >
          <ViewGridIcon className="view-toggle__icon" size={18} />
        </button>
        <button
          type="button"
          className={`toggle-button${isDeskView ? ' active' : ''}`}
          onClick={() => onViewModeChange?.('desk')}
          aria-pressed={isDeskView}
          title="Desk view"
        >
          <IconFileStack className="view-toggle__icon" size={18} />
        </button>
      </div>
      <span className="main-content__actions-divider" aria-hidden="true">
        <MinusVerticalIcon />
      </span>
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
