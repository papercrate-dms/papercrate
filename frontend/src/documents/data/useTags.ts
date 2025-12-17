import { MutableRefObject, useCallback, useSyncExternalStore } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import type { TagId, TenantId } from '../../types/identifiers';
import type { Tag } from '../../types/documents';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import TagManager from '../../lib/assets/TagManager';

interface UseTagsOptions {
  tagManager: TagManager;
  tenantIdRef: MutableRefObject<TenantId | null>;
  setActiveTagFilters: (updater: (prev: Array<TagId>) => Array<TagId>) => void;
  documentsManager?: { map: (mapper: (doc: any) => any) => void };
}

interface UseTagsResult {
  tags: Tag[];
  tagLookupById: Map<TagId, Tag>;
  refreshTags: () => Promise<void>;
  handleTagUpdate: (tagId: TagId, changes: { label?: string; color?: string | null }) => Promise<boolean>;
  handleTagCreate: (payload?: { label?: string; color?: string | null }) => Promise<void>;
  handleTagDelete: (tagId: TagId) => Promise<boolean>;
  tagManager: TagManager;
}

const useTags = ({
  tagManager,
  setActiveTagFilters,
  documentsManager,
}: UseTagsOptions): UseTagsResult => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const tagsSnapshot = useSyncExternalStore<Map<TagId, Tag>>(
    useCallback((cb) => tagManager.subscribe(cb), [tagManager]),
    () => tagManager.getSnapshot(),
    () => tagManager.getSnapshot(),
  );

  const tags = Array.from(tagsSnapshot.values())
    .filter((tag): tag is Tag => (tag as any).id != null && (tag as any).label != null) // Ensure strict adherence
    .sort((a, b) =>
      (a.label || '').localeCompare(b.label || '')
    );

  const refreshTags = useCallback(async () => {
    try {
      await tagManager.ensureAll(true);
    } catch (error) {
      notifyApiError(error, 'Unable to load tags.');
    }
  }, [notifyApiError, tagManager]);

  const handleTagUpdate = useCallback(
    async (tagId: TagId, changes: { label?: string; color?: string | null }) => {
      if (tagId == null) {
        throw new Error('Missing tag identifier.');
      }

      const payload: Record<string, string> = {};
      if (changes?.label != null) {
        payload.label = changes.label;
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'color')) {
        payload.color = changes.color || ''; // API might behave differently if color is literally null, usually string expected
      }

      if (Object.keys(payload).length === 0) {
        return false;
      }

      try {
        await tagManager.update(tagId, payload as any);
        showToast('Tag updated.', 'success');
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to update tag.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [notifyApiError, tagManager, showToast],
  );

  const handleTagCreate = useCallback(
    async ({ label, color }: { label?: string; color?: string | null } = {}) => {
      const payload = tagManager.buildPayload({ label, color });
      try {
        const newTag = await tagManager.create(payload);
        showToast('Tag created.', 'success');
        return newTag;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to create tag.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [notifyApiError, showToast, tagManager],
  );

  const handleTagDelete = useCallback(
    async (tagId: TagId) => {
      if (tagId == null) {
        throw new Error('Missing tag identifier.');
      }

      try {
        await tagManager.delete(tagId);
        setActiveTagFilters((prev) => prev.filter((id) => id !== tagId));

        const stripTagFromDoc = (doc: any) => {
          if (!doc || !Array.isArray(doc.tags)) {
            return doc;
          }
          const nextTags = doc.tags.filter((tag: Tag) => tag.id !== tagId);
          if (nextTags.length === doc.tags.length) {
            return doc;
          }
          return { ...doc, tags: nextTags };
        };

        documentsManager?.map(stripTagFromDoc);
        showToast('Tag deleted.', 'success');
        return true;
      } catch (error) {
        const message = error.response?.data?.error || 'Failed to delete tag.';
        notifyApiError(error, message);
        throw new Error(message);
      }
    },
    [documentsManager, notifyApiError, setActiveTagFilters, showToast, tagManager],
  );

  return {
    tags,
    tagLookupById: tagsSnapshot,
    refreshTags,
    handleTagUpdate,
    handleTagCreate,
    handleTagDelete,
    tagManager,
  };
};

export default useTags;
