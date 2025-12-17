import { generateRandomTagColor } from '../../utils/colors';
import { listTags, createTag, updateTag, deleteTag } from '../api/apiClient';
import type { TagId } from '../../types/identifiers';
import type { Tag } from '../../types/documents';

type ColorGenerator = () => string;

interface TagManagerOptions {
  colorGenerator?: ColorGenerator;
}

interface TagPayload {
  label: string;
  color: string;
}

type Listener = () => void;

class TagManager {
  private readonly colorGenerator: ColorGenerator;
  private byId: Map<TagId, Tag> = new Map();
  private listeners: Set<Listener> = new Set();
  private tagsPromise: Promise<Tag[]> | null = null;
  private loaded = false;

  constructor({ colorGenerator = generateRandomTagColor }: TagManagerOptions = {}) {
    this.colorGenerator = colorGenerator;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  getSnapshot(): Map<TagId, Tag> {
    return this.byId;
  }

  ingest(tags: Tag[]): void {
    let changed = false;
    let nextMap: Map<TagId, Tag> | null = null;

    tags.forEach((tag) => {
      if (!tag.id) return;
      const existing = this.byId.get(tag.id);
      if (JSON.stringify(existing) !== JSON.stringify(tag)) {
        if (!nextMap) nextMap = new Map(this.byId);
        nextMap.set(tag.id, tag);
        changed = true;
      }
    });

    if (changed && nextMap) {
      this.byId = nextMap;
      this.emit();
    }
  }

  remove(ids: TagId[]): void {
    let changed = false;
    let nextMap: Map<TagId, Tag> | null = null;

    ids.forEach((id) => {
      if (this.byId.has(id)) {
        if (!nextMap) nextMap = new Map(this.byId);
        nextMap.delete(id);
        changed = true;
      }
    });
    if (changed && nextMap) {
      this.byId = nextMap;
      this.emit();
    }
  }

  async ensureAll(force = false): Promise<Tag[]> {
    if (this.loaded && !force && this.byId.size > 0) {
      return Array.from(this.byId.values());
    }

    if (this.tagsPromise && !force) {
      return this.tagsPromise;
    }

    this.tagsPromise = this.fetchTagsInternal();
    return this.tagsPromise;
  }

  private async fetchTagsInternal(): Promise<Tag[]> {
    try {
      const tags = await listTags();
      const castTags = (tags || []) as unknown as Tag[];
      this.byId = new Map(); // Reset
      castTags.forEach(tag => {
        if (tag.id) this.byId.set(tag.id, tag);
      });
      // Emit strictly needed? Usually ingest handles this but here we doing full reset
      this.emit();
      this.loaded = true;
      return castTags;
    } catch (error) {
      console.warn('Failed to fetch tags', error);
      return [];
    } finally {
      this.tagsPromise = null;
    }
  }

  async create(payload: TagPayload): Promise<Tag> {
    const response = await createTag(payload);
    const newTag = response as unknown as Tag;
    this.ingest([newTag]);
    return newTag;
  }

  async update(tagId: TagId, changes: Partial<TagPayload>): Promise<void> {
    await updateTag(tagId, changes);
    // Optimistic update or re-fetch?
    // Since updateTag doesn't return the full tag, we can optimistically update
    const existing = this.byId.get(tagId);
    if (existing) {
      const updated = { ...existing, ...changes };
      this.ingest([updated]);
    } else {
      // Fallback: fetch specific tag or refresh all?
      // For now, let's refresh all to be safe, or just ignore if we don't have it.
      // But if we are updating it, we probably should have it.
      // Let's trigger a refresh in background to be safe.
      this.ensureAll(true);
    }
  }

  async delete(tagId: TagId): Promise<void> {
    await deleteTag(tagId);
    this.remove([tagId]);
  }

  normalizeLabel(label?: string | null): string {
    return label?.trim?.() || '';
  }

  buildPayload({ label, color }: { label?: string | null; color?: string | null } = {}): TagPayload {
    const normalizedLabel = this.normalizeLabel(label);
    if (!normalizedLabel) {
      throw new Error('Tag label is required.');
    }
    const trimmedColor = color?.trim?.() || null;
    return {
      label: normalizedLabel,
      color: trimmedColor || this.colorGenerator(),
    };
  }
}

export default TagManager;
