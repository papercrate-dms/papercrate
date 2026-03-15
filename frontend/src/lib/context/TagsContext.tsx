import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { TagId } from '../../types/identifiers';
import type { Tag } from '../../types/documents';
import type TagManager from '../assets/TagManager';

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
  openTagsModal: () => void;
}

const [TagsCtx, useTags] = createSafeContext<TagsContextValue>('Tags');

export const TagsProvider: React.FC<{ value: TagsContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <TagsCtx.Provider value={value}>{children}</TagsCtx.Provider>
);

export { useTags };
