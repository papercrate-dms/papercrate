import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { Identifier } from '../../types/identifiers';
import type { Correspondent } from '../../types/documents';
import type CorrespondentManager from '../assets/CorrespondentManager';
import useCorrespondentsHook from '../../documents/data/useCorrespondents';
import { useDocumentsSearch } from './DocumentsSearchContext';

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
}

const [CorrespondentsCtx, useCorrespondents] = createSafeContext<CorrespondentsContextValue>('Correspondents');

interface CorrespondentsProviderProps {
  /** CorrespondentManager instance owned by the orchestration layer */
  correspondentManager: CorrespondentManager;
  /** documentsManager — needed for correspondent-delete side-effects */
  documentsManager: { map: (mapper: (doc: any) => any) => void } | null;
  /** Mutation handlers assembled by the workspace orchestration layer */
  handleDocumentCorrespondentAttach: (...args: unknown[]) => unknown;
  handleDocumentCorrespondentDetach: (...args: unknown[]) => unknown;
  handleDocumentCorrespondentAdd: (...args: unknown[]) => unknown;
  handleBulkCorrespondentAdd: (...args: unknown[]) => unknown;
  handleBulkCorrespondentRemove: (...args: unknown[]) => unknown;
  children: React.ReactNode;
}

export const CorrespondentsProvider: React.FC<CorrespondentsProviderProps> = ({
  correspondentManager,
  documentsManager,
  handleDocumentCorrespondentAttach,
  handleDocumentCorrespondentDetach,
  handleDocumentCorrespondentAdd,
  handleBulkCorrespondentAdd,
  handleBulkCorrespondentRemove,
  children,
}) => {
  // Search context is above Correspondents in the provider stack — read filter state directly.
  const { activeCorrespondentFilters } = useDocumentsSearch();

  const correspondentsState = useCorrespondentsHook({
    correspondentManager,
    documentsManager: documentsManager ?? undefined,
  });

  const value: CorrespondentsContextValue = {
    ...correspondentsState,
    activeCorrespondentFilters,
    handleDocumentCorrespondentAttach,
    handleDocumentCorrespondentDetach,
    handleDocumentCorrespondentAdd,
    handleBulkCorrespondentAdd,
    handleBulkCorrespondentRemove,
  };

  return <CorrespondentsCtx.Provider value={value}>{children}</CorrespondentsCtx.Provider>;
};

export { useCorrespondents };
