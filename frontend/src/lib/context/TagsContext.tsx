import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { TagId } from '../../types/identifiers';
import type { Tag } from '../../types/documents';
import type TagManager from '../assets/TagManager';
import useTagsHook from '../../documents/data/useTags';
import { useDocumentsSearch } from './DocumentsSearchContext';

export interface TagsContextValue {
  tags: Tag[];
  tagLookupById: Map<TagId, Tag>;
  tagManager: TagManager;
  activeTagFilters: TagId[];
  refreshTags: () => Promise<void>;
  handleTagCreate: (payload?: { label?: string; color?: string | null }) => Promise<unknown>;
  handleTagUpdate: (tagId: TagId, changes: { label?: string; color?: string | null }) => Promise<boolean>;
  handleTagDelete: (tagId: TagId) => Promise<boolean>;
  handleDocumentTagAttach: (...args: unknown[]) => unknown;
  handleDocumentTagDetach: (...args: unknown[]) => unknown;
  handleBulkTagAddFromDetail: (...args: unknown[]) => unknown;
  handleBulkTagRemoveFromDetail: (...args: unknown[]) => unknown;
}

const [TagsCtx, useTags] = createSafeContext<TagsContextValue>('Tags');

interface TagsProviderProps {
  /** TagManager instance owned by the orchestration layer */
  tagManager: TagManager;
  /** documentsManager from the documents store — needed for tag-delete side-effects */
  documentsManager: { map: (mapper: (doc: any) => any) => void } | null;
  /** Tag mutation handlers assembled by the workspace orchestration layer */
  handleDocumentTagAttach: (...args: unknown[]) => unknown;
  handleDocumentTagDetach: (...args: unknown[]) => unknown;
  handleBulkTagAddFromDetail: (...args: unknown[]) => unknown;
  handleBulkTagRemoveFromDetail: (...args: unknown[]) => unknown;
  children: React.ReactNode;
}

export const TagsProvider: React.FC<TagsProviderProps> = ({
  tagManager,
  documentsManager,
  handleDocumentTagAttach,
  handleDocumentTagDetach,
  handleBulkTagAddFromDetail,
  handleBulkTagRemoveFromDetail,
  children,
}) => {
  // Search context is above Tags in the provider stack — read filter state directly.
  const { activeTagFilters, setActiveTagFilters } = useDocumentsSearch();

  const tagsState = useTagsHook({
    tagManager,
    tenantIdRef: { current: null },
    setActiveTagFilters,
    documentsManager: documentsManager ?? undefined,
  });

  const value: TagsContextValue = {
    ...tagsState,
    activeTagFilters,
    handleDocumentTagAttach,
    handleDocumentTagDetach,
    handleBulkTagAddFromDetail,
    handleBulkTagRemoveFromDetail,
  };

  return <TagsCtx.Provider value={value}>{children}</TagsCtx.Provider>;
};

export { useTags };
