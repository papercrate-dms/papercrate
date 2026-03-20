import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import { useFolder } from './FolderContext';
import useDocumentsSearchHook from '../../app/useDocumentsSearch';
import useWorkspaceViewData from '../../documents/data/useWorkspaceViewData';
import type { DocumentId, Identifier } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import type { DocumentsFilterValue } from '../../documents/context/DocumentsFilterContext';
import type DocumentsManager from '../../documents/DocumentsManager';

export interface DocumentsSearchContextValue {
  searchQuery: string;
  searchLoading: boolean;
  documentsViewMode: string;
  handleDocumentsViewModeChange: (mode: string) => void;
  documentsSortField: string;
  documentsSortDirection: string;
  handleDocumentsSortFieldChange: (field: string) => void;
  handleDocumentsSortDirectionToggle: () => void;
  searchResultIds: DocumentId[] | null;
  documents: Document[];
  documentsFilter: DocumentsFilterValue;
  documentsManager: DocumentsManager<Document>;
  documentLookup: Map<DocumentId, Document>;
  // View data (derived from search + folder contents)
  visibleEntryKeySet: Set<string>;
  showingSearchResults: boolean;
  // Exposed for providers nested below (Tags, Correspondents)
  activeTagFilters: Identifier[];
  setActiveTagFilters: (updater: ((prev: Identifier[]) => Identifier[]) | Identifier[]) => void;
  activeCorrespondentFilters: Identifier[];
  setActiveCorrespondentFilters: (updater: ((prev: Identifier[]) => Identifier[]) | Identifier[]) => void;
}

const [DocumentsSearchCtx, useDocumentsSearch] = createSafeContext<DocumentsSearchContextValue>('DocumentsSearch');

type ApiClient = {
  get: <T = unknown>(url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: T }>;
};

export interface DocumentsSearchProviderProps {
  // Inputs for useDocumentsSearch hook
  api: ApiClient;
  locationPathname: string;
  isWorkspaceRoute: boolean;
  searchIncludeDescendants: boolean;
  documentsSortField: string;
  documentsSortDirection: string;
  setSearchIncludeDescendants: (value: boolean) => void;
  documentsManager: DocumentsManager<Document>;
  // View/sort handlers (not owned by search, but exposed on context for consumers)
  documentsViewMode: string;
  handleDocumentsViewModeChange: (mode: string) => void;
  handleDocumentsSortFieldChange: (field: string) => void;
  handleDocumentsSortDirectionToggle: () => void;
  // Raw document data from managers (view filtering done internally via useWorkspaceViewData)
  rawDocuments: Document[];
  documentLookup: Map<DocumentId, Document>;
  children: React.ReactNode;
}

export const DocumentsSearchProvider: React.FC<DocumentsSearchProviderProps> = ({
  api,
  locationPathname,
  isWorkspaceRoute,
  searchIncludeDescendants,
  documentsSortField,
  documentsSortDirection,
  setSearchIncludeDescendants,
  documentsManager,
  documentsViewMode,
  handleDocumentsViewModeChange,
  handleDocumentsSortFieldChange,
  handleDocumentsSortDirectionToggle,
  rawDocuments,
  documentLookup,
  children,
}) => {
  // Read folder state from FolderProvider (above us in the stack).
  const { selectedFolder, visibleSubfolders } = useFolder();

  const search = useDocumentsSearchHook({
    api,
    selectedFolder,
    locationPathname,
    isWorkspaceRoute,
    searchIncludeDescendants,
    documentsSortField,
    documentsSortDirection,
    setSearchIncludeDescendants,
    documentsManager,
  });

  const searchResultIds = search.searchResultIds as DocumentId[] | null;
  const showingSearchResults = searchResultIds !== null;

  // Derive the visible document list from raw documents + search results + folder contents.
  const { viewDocuments, visibleEntryKeySet } = useWorkspaceViewData({
    documents: rawDocuments,
    documentLookup,
    searchResultIds,
    showingSearchResults,
    currentSubfolders: visibleSubfolders,
    selectedFolder,
  });

  const value: DocumentsSearchContextValue = {
    searchQuery: search.searchQuery,
    searchLoading: search.searchLoading,
    documentsViewMode,
    handleDocumentsViewModeChange,
    documentsSortField,
    documentsSortDirection,
    handleDocumentsSortFieldChange,
    handleDocumentsSortDirectionToggle,
    searchResultIds,
    documents: viewDocuments,
    documentsFilter: search.documentsFilterValue,
    documentsManager,
    documentLookup,
    visibleEntryKeySet,
    showingSearchResults,
    activeTagFilters: search.activeTagFilters,
    setActiveTagFilters: search.setActiveTagFilters,
    activeCorrespondentFilters: search.activeCorrespondentFilters,
    setActiveCorrespondentFilters: search.setActiveCorrespondentFilters,
  };

  return <DocumentsSearchCtx.Provider value={value}>{children}</DocumentsSearchCtx.Provider>;
};

export { useDocumentsSearch };
