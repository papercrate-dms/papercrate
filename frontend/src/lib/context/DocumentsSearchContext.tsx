import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { DocumentId } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import type { DocumentsFilterValue } from '../../documents/context/DocumentsFilterContext';

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
  documentsManager: unknown;
  documentLookup: Map<DocumentId, Document>;
}

const [DocumentsSearchCtx, useDocumentsSearch] = createSafeContext<DocumentsSearchContextValue>('DocumentsSearch');

export const DocumentsSearchProvider: React.FC<{ value: DocumentsSearchContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <DocumentsSearchCtx.Provider value={value}>{children}</DocumentsSearchCtx.Provider>
);

export { useDocumentsSearch };
