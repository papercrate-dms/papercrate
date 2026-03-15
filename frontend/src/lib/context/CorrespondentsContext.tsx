import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { Identifier } from '../../types/identifiers';
import type { Correspondent } from '../../types/documents';

export interface CorrespondentsContextValue {
  correspondents: Correspondent[];
  correspondentLookupById: Map<Identifier, Correspondent>;
  correspondentLookupByName: Map<string, Correspondent>;
  activeCorrespondentFilters: Identifier[];
  activeCorrespondentIds?: Identifier[];
  refreshCorrespondents: () => Promise<void>;
  handleCorrespondentCreate: (payload: { name?: string }) => Promise<unknown>;
  handleCorrespondentUpdate: (id: Identifier, changes: { name?: string }) => Promise<boolean>;
  handleCorrespondentDelete: (id: Identifier) => Promise<boolean>;
  handleDocumentCorrespondentAttach: (...args: unknown[]) => unknown;
  handleDocumentCorrespondentDetach: (...args: unknown[]) => unknown;
  handleDocumentCorrespondentAdd: (...args: unknown[]) => unknown;
  handleBulkCorrespondentAdd: (...args: unknown[]) => unknown;
  handleBulkCorrespondentRemove: (...args: unknown[]) => unknown;
  openCorrespondentsModal: () => void;
}

const [CorrespondentsCtx, useCorrespondents] = createSafeContext<CorrespondentsContextValue>('Correspondents');

export const CorrespondentsProvider: React.FC<{ value: CorrespondentsContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <CorrespondentsCtx.Provider value={value}>{children}</CorrespondentsCtx.Provider>
);

export { useCorrespondents };
