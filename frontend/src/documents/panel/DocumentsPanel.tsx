import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import TagRemovalZone from '../components/TagRemovalZone';
import { DocumentsList, DocumentsGrid } from '../DocumentsView';
import type { ReactNode } from 'react';
import type {
  DocumentsListEntry,
} from '../../types/documents';
import { EntryType } from '../../constants/documents';

import DesktopWorkspace from '../../desktop/components/DesktopWorkspace';
import {
  WorkspaceSelectionProvider,
  useWorkspaceSelectionContext,
} from '../../app/WorkspaceSelectionContext';
import DocumentsPanelHeader, {
  DocumentsPanelHeaderConfig,
} from './DocumentsPanelHeader';
import { SelectionFloatingPanel } from '../features/selection/SelectionFloatingActions';
import { createDocumentsTableHeaderActions } from './DocumentsToolbar';
import { useDocumentsFilter } from '../context/DocumentsFilterContext';
import {
  DEFAULT_GRID_ICON_SIZE,
  DEFAULT_LIST_ICON_SIZE,
  DEFAULT_DESKTOP_CARD_SIZE,
} from '../../constants/documents';
import { DocumentsAssetContext } from '../context/DocumentsAssetContext';
import { DocumentsViewStateContext } from '../context/DocumentsViewStateContext';
import { DocumentsCommandContext } from '../context/DocumentsCommandContext';
import { useDocumentsContextValues } from './useDocumentsContextValues';
import { useFolderTree } from '../../lib/context/FolderTreeContext';
import { useDocumentsSearch } from '../../lib/context/DocumentsSearchContext';
import { useDocumentsWorkspaceContext } from '../../lib/context/DocumentsWorkspaceContext';
import type { TagInteractionHandlers } from '../interactions/useTagInteractions';

export interface DocumentsViewProps {
  entries: DocumentsListEntry[];
  tagHandlers?: TagInteractionHandlers;
  [key: string]: any;
}

interface DocumentsPanelProps {
  headerLeading?: ReactNode;
}

const DocumentsPanelInner: React.FC<DocumentsPanelProps> = React.memo((props) => {
  const { headerLeading } = props;

  const { documents, searchResultIds, documentsViewMode: viewMode, documentsSortField: sortField, documentsSortDirection: sortDirection, handleDocumentsViewModeChange: onViewModeChange, handleDocumentsSortFieldChange: onSortFieldChange, handleDocumentsSortDirectionToggle: onSortDirectionToggle, documentLookup, searchLoading: isSearchLoading } = useDocumentsSearch();
  const { currentFolderName, breadcrumbs, currentSubfolders: subfolders, handleBreadcrumbNavigate: onBreadcrumbNavigate, refreshCurrentFolder: onRefresh } = useFolderTree();

  const {
    assetContextValue,
    viewStateContextValue,
    commandContextValue,
    tagHandlers,
    scrollRef,
    hasDocumentEntries,
  } = useDocumentsContextValues();

  const {
    clearSelection,
  } = useWorkspaceSelectionContext();
  const {
    isActive: isFilterActive,
    includeDescendants,
    toggleIncludeDescendants,
  } = useDocumentsFilter();

  const searchDocuments = useMemo(
    () =>
      Array.isArray(searchResultIds)
        ? searchResultIds
          .map((id: any) => documentLookup?.get?.(id) || null)
          .filter((doc: any): doc is Record<string, unknown> => Boolean(doc))
        : null,
    [searchResultIds, documentLookup],
  );

  const showingSearchResults = Array.isArray(searchResultIds);
  const rows = showingSearchResults && searchDocuments ? searchDocuments : documents;

  const headerTitle = showingSearchResults
    ? 'Search results'
    : currentFolderName || 'Documents';

  const headerActions = useMemo(
    () => createDocumentsTableHeaderActions({
      viewMode,
      onViewModeChange,
      onRefresh,
      sortField,
      onSortFieldChange,
      sortDirection,
      onSortDirectionToggle,
      isFilterActive,
      includeDescendants,
      onToggleIncludeDescendants: toggleIncludeDescendants,
    }),
    [
      viewMode,
      onViewModeChange,
      onRefresh,
      sortField,
      onSortFieldChange,
      sortDirection,
      onSortDirectionToggle,
      isFilterActive,
      includeDescendants,
      toggleIncludeDescendants,
    ],
  );

  const floatingActions = useMemo(() => (
    <SelectionFloatingPanel onClearSelection={clearSelection} />
  ), [clearSelection]);

  const headerConfig: DocumentsPanelHeaderConfig = useMemo(() => ({
    title: headerTitle,
    subtitle: null,
    leading: headerLeading,
    actions: headerActions,
    breadcrumbs,
    floatingActions,
  }), [
    headerTitle,
    headerLeading,
    headerActions,
    breadcrumbs,
    floatingActions,
  ]);

  const currentFolderId = useMemo(() => {
    if (showingSearchResults) {
      return null;
    }
    const trail = Array.isArray(breadcrumbs) ? breadcrumbs : [];
    if (trail.length === 0) {
      return 'root';
    }
    return trail[trail.length - 1]?.id || 'root';
  }, [breadcrumbs, showingSearchResults]);

  // Context marker logic for clearing selection on nav
  const selectionContextRef = useRef<any>(null);
  useEffect(() => {
    const nextContext = showingSearchResults
      ? { type: 'search', marker: searchResultIds }
      : { type: 'folder', marker: currentFolderId || 'root' };
    const previous = selectionContextRef.current;
    selectionContextRef.current = nextContext;
    if (!previous) {
      return;
    }
    const changed = previous.type !== nextContext.type
      || previous.marker !== nextContext.marker;
    if (changed) {
      clearSelection();
    }
  }, [showingSearchResults, currentFolderId, searchResultIds, clearSelection]);

  const entries = useMemo(() => {
    const list: DocumentsListEntry[] = [];
    if (!showingSearchResults) {
      (subfolders || []).forEach((folder: any) => {
        if (!folder || !folder.id) {
          return;
        }
        list.push({ type: EntryType.folder, id: folder.id, key: `folder:${folder.id}`, folder });
      });
    }
    (rows || []).forEach((doc: any) => {
      if (!doc || !doc.id) {
        return;
      }
      list.push({ type: EntryType.document, id: doc.id, key: `document:${doc.id}`, document: doc });
    });
    return list;
  }, [showingSearchResults, subfolders, rows]);

  const isGridView = viewMode === 'grid';
  const isDeskView = viewMode === 'desk';

  const viewProps = {
    entries,
    viewId: currentFolderId,
    tagHandlers,
  };

  const [iconSizes] = useState({
    list: DEFAULT_LIST_ICON_SIZE,
    grid: DEFAULT_GRID_ICON_SIZE,
    desk: DEFAULT_DESKTOP_CARD_SIZE,
  });

  const renderBody = () => {
    const hasEntries = entries.length > 0;
    const isSearchEmpty = (showingSearchResults || isFilterActive) && !hasDocumentEntries && !isSearchLoading;

    if (isSearchEmpty) {
      return (
        <div className="empty-state">
          No documents match the current filters.
        </div>
      );
    }

    if (!hasEntries) {
      return (
        <div className="empty-state">
          No documents to show here yet. Drop files to make this space come alive.
        </div>
      );
    }

    switch (viewMode) {
      case 'desk':
        return <DesktopWorkspace {...viewProps} defaultCardSize={iconSizes.desk} />;
      case 'grid':
        return <DocumentsGrid {...viewProps} iconSize={iconSizes.grid} />;
      case 'list':
      default:
        return <DocumentsList {...viewProps} iconSize={iconSizes.list} />;
    }
  };

  const panelVariant = isDeskView ? 'desk' : isGridView ? 'grid' : 'list';
  const shouldHandlePanelInteractions = !isDeskView && entries.length > 0;

  const handleSectionClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!shouldHandlePanelInteractions || event.target !== event.currentTarget) {
      return;
    }
    clearSelection();
  }, [shouldHandlePanelInteractions, clearSelection]);

  return (
    <DocumentsAssetContext.Provider value={assetContextValue}>
      <DocumentsViewStateContext.Provider value={viewStateContextValue}>
        <DocumentsCommandContext.Provider value={commandContextValue}>
          <DocumentsPanelHeader
            header={headerConfig}
            onBreadcrumbClick={onBreadcrumbNavigate}
          />
          <div className="documents-panel-wrapper">
            <TagRemovalZone />
            <section
              ref={scrollRef}
              className={`documents-panel documents-panel--view-${panelVariant}`}
              onClick={handleSectionClick}
            >
              {renderBody()}
            </section>
          </div>
        </DocumentsCommandContext.Provider>
      </DocumentsViewStateContext.Provider>
    </DocumentsAssetContext.Provider>
  );
});

DocumentsPanelInner.displayName = 'DocumentsPanelInner';

const DocumentsPanel: React.FC<DocumentsPanelProps> = (props) => {
  const { selectionValue } = useDocumentsWorkspaceContext();

  return (
    <WorkspaceSelectionProvider value={selectionValue}>
      <DocumentsPanelInner {...props} />
    </WorkspaceSelectionProvider>
  );
};

export default DocumentsPanel;
