import React from 'react';
import type { Identifier } from '../../types/identifiers';
import { createSafeContext } from '../../utils/createSafeContext';

export interface DocumentsFilterValue {
  query: string;
  searchResultIds: Array<string> | null;
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
}

const [DocumentsFilterContext, useDocumentsFilter] = createSafeContext<DocumentsFilterValue>('DocumentsFilter');

interface DocumentsFilterProviderProps {
  value: DocumentsFilterValue;
  children: React.ReactNode;
}

export const DocumentsFilterProvider: React.FC<DocumentsFilterProviderProps> = ({ value, children }) => (
  <DocumentsFilterContext.Provider value={value}>{children}</DocumentsFilterContext.Provider>
);

export { useDocumentsFilter };
