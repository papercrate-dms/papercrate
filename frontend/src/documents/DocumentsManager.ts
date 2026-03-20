import shallowEqual from '../utils/shallowEqual';
import { extractDocumentFromResponse } from './data/useWorkspaceManagers';
import type { DocumentId, Identifier, TagId } from '../types/identifiers';
import type { Tag, Correspondent } from '../types/documents';
import type TagManager from '../lib/assets/TagManager';
import type CorrespondentManager from '../lib/assets/CorrespondentManager';
import {
  listDocuments,
  updateDocument,
  trashDocument,
  restoreDocument,
  purgeDocument,
  queueDocumentReanalysis,
  bulkReanalyzeDocuments,
  addDocumentTags,
  deleteDocumentTag,
  bulkTagDocuments,
  addDocumentCorrespondent,
  removeDocumentCorrespondent,
  assignCorrespondentsBulk,
  moveDocumentToFolder,
  moveDocumentsBulk,
} from '../lib/api/apiClient';

type ManagedDocument = { id?: DocumentId | null; tags?: Identifier[] | null; correspondents?: Identifier[] | null } & Record<string, unknown>;

type FetchDocument = (id: DocumentId) => Promise<unknown>;

class DocumentsManager<T extends ManagedDocument = ManagedDocument> {
  private byId: Map<DocumentId, T>;
  private fetcher?: FetchDocument;
  private inflight: Map<DocumentId, Promise<T | null>>;
  private listeners: Set<() => void>;
  private emitScheduled: boolean;
  private tagManager?: TagManager;
  private correspondentManager?: CorrespondentManager;

  constructor(
    fetchDocument?: FetchDocument,
  ) {
    this.byId = new Map();
    this.fetcher = fetchDocument;
    this.inflight = new Map();
    this.listeners = new Set();
    this.emitScheduled = false;
  }

  setTagManager(tagManager: TagManager) {
    this.tagManager = tagManager;
  }

  setCorrespondentManager(correspondentManager: CorrespondentManager) {
    this.correspondentManager = correspondentManager;
  }

  private emit() {
    if (this.emitScheduled) {
      return;
    }
    this.emitScheduled = true;
    setTimeout(() => {
      this.emitScheduled = false;
      this.listeners.forEach((fn) => fn());
    }, 0);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setFetcher(fetchDocument?: FetchDocument) {
    this.fetcher = fetchDocument;
  }

  ingest(rawDocs: unknown[] = []): { canonical: T[]; changed: boolean } {
    const docs = rawDocs.map((doc) => doc as T).filter(Boolean);
    let changed = false;
    let nextById = this.byId;
    const canonical: T[] = [];

    docs.forEach((doc) => {
      const id = doc?.id;
      if (id == null) {
        canonical.push(doc);
        return;
      }

      if (this.tagManager && Array.isArray((doc as any).tags)) {
        const rawTags = (doc as any).tags as any[];
        // Skip extraction if array already contains plain IDs (strings)
        if (rawTags.length > 0 && typeof rawTags[0] === 'object') {
          const validTags: Tag[] = [];
          const tagIds: TagId[] = [];

          rawTags.forEach(tag => {
            if (tag.id) {
              tagIds.push(tag.id);
              validTags.push(tag as Tag);
            }
          });

          if (validTags.length > 0) {
            this.tagManager.ingest(validTags);
          }

          (doc as any).tags = tagIds;
        }
      }

      if (this.correspondentManager && Array.isArray((doc as any).correspondents)) {
        const rawCorrespondents = (doc as any).correspondents as any[];
        // Skip extraction if array already contains plain IDs (strings)
        if (rawCorrespondents.length > 0 && typeof rawCorrespondents[0] === 'object') {
          const validCorrespondents: Correspondent[] = [];
          const correspondentIds: Identifier[] = [];

          rawCorrespondents.forEach(corr => {
            if (corr.id) {
              correspondentIds.push(corr.id);
              validCorrespondents.push(corr as Correspondent);
            }
          });

          if (validCorrespondents.length > 0) {
            this.correspondentManager.ingest(validCorrespondents);
          }
          (doc as any).correspondents = correspondentIds;
        }
      }

      const existing = nextById.get(id as DocumentId);
      const merged = existing ? ({ ...existing, ...doc } as T) : ({ ...(doc as T) } as T);
      const useExisting = existing && shallowEqual(existing, merged);
      const nextDoc = useExisting ? (existing as T) : merged;

      if (!useExisting) {
        if (!changed) {
          nextById = new Map(this.byId);
        }
        nextById.set(id as DocumentId, nextDoc);
        changed = true;
      }
      canonical.push(nextDoc);
    });

    if (changed) {
      this.byId = nextById;
      this.emit();
    }

    return { canonical, changed };
  }

  async ensure(id: DocumentId, fetcherOverride?: FetchDocument): Promise<T | null> {
    if (id == null) {
      return null;
    }

    const cached = this.byId.get(id);
    if (cached) {
      return cached;
    }

    const fetcher = fetcherOverride || this.fetcher;
    if (!fetcher) {
      return null;
    }

    const inflight = this.inflight.get(id);
    if (inflight) {
      return inflight;
    }

    const request = (async () => {
      try {
        const fetched = await fetcher(id);
        const { canonical } = this.ingest([fetched as unknown]);
        return canonical[0] ?? null;
      } finally {
        this.inflight.delete(id);
      }
    })();

    this.inflight.set(id, request);
    return request;
  }

  update(id: DocumentId, updater: (doc: T) => Partial<T> | T | undefined): boolean {
    const doc = this.byId.get(id);
    if (!doc) {
      return false;
    }
    const changes = updater(doc);
    if (!changes) {
      return false;
    }
    const { changed } = this.ingest([{ ...doc, ...changes }]);
    return changed;
  }

  map(mapper: (doc: T) => T | undefined): boolean {
    if (!this.byId.size) {
      return false;
    }

    let changed = false;
    let next = this.byId;
    this.byId.forEach((doc, key) => {
      const updated = mapper(doc);
      const nextDoc = updated === undefined ? doc : updated;
      if (nextDoc !== doc) {
        if (!changed) {
          next = new Map(this.byId);
        }
        changed = true;
        next.set(key, nextDoc ?? doc);
      }
    });

    if (changed) {
      this.byId = next;
      this.emit();
    }

    return changed;
  }

  remove(ids: Array<DocumentId>): boolean {
    if (!Array.isArray(ids) || ids.length === 0) {
      return false;
    }
    let changed = false;
    let next = this.byId;
    ids.forEach((id) => {
      if (next.has(id)) {
        if (!changed) {
          next = new Map(this.byId);
        }
        next.delete(id);
        changed = true;
      }
    });
    if (changed) {
      this.byId = next;
      this.emit();
    }
    return changed;
  }

  getById(id: DocumentId): T | null {
    return this.byId.get(id) ?? null;
  }

  getMany(ids: Array<DocumentId> = []): T[] {
    return ids
      .map((id) => this.byId.get(id) || null)
      .filter((doc): doc is T => Boolean(doc));
  }

  async list(params: Record<string, unknown> = {}, options?: { signal?: AbortSignal }): Promise<DocumentId[]> {
    const results = await listDocuments(params, options);
    const safe = Array.isArray(results) ? results : [];
    const { canonical } = this.ingest(safe as unknown[]);
    return canonical
      .map((doc) => doc?.id as DocumentId)
      .filter((id): id is DocumentId => id != null);
  }

  getSnapshot(): Map<DocumentId, T> {
    return this.byId;
  }

  // --- Mutations ---

  async updateFields(id: DocumentId, fields: Record<string, unknown>): Promise<T | null> {
    const data = await updateDocument(id, fields);
    const doc = extractDocumentFromResponse(data);
    if (doc) {
      const { canonical } = this.ingest([doc]);
      return canonical[0] ?? null;
    }
    this.update(id, (d) => ({ ...d, ...fields } as T));
    return this.getById(id);
  }

  async trash(id: DocumentId): Promise<void> {
    await trashDocument(id);
  }

  async restore(id: DocumentId, folderId?: Identifier | null): Promise<void> {
    await restoreDocument(id, folderId);
  }

  async purge(id: DocumentId): Promise<void> {
    await purgeDocument(id);
  }

  async reanalyze(id: DocumentId, options?: { force?: boolean }): Promise<void> {
    await queueDocumentReanalysis(id, options);
  }

  async bulkReanalyze(ids: Identifier[]): Promise<{ queued?: number }> {
    return bulkReanalyzeDocuments({ document_ids: ids });
  }

  async addTags(documentId: DocumentId, tagIds: Identifier[]): Promise<void> {
    await addDocumentTags(documentId, tagIds);
    this.update(documentId, (doc) => {
      const current = doc.tags ?? [];
      const currentSet = new Set(current);
      const next = [...current, ...tagIds.filter((id) => !currentSet.has(id))];
      return { ...doc, tags: next } as T;
    });
  }

  async removeTag(documentId: DocumentId, tagId: Identifier): Promise<void> {
    await deleteDocumentTag(documentId, tagId);
    this.update(documentId, (doc) => {
      const current = doc.tags ?? [];
      const next = current.filter((id: Identifier) => id !== tagId);
      return next.length === current.length ? doc : ({ ...doc, tags: next } as T);
    });
  }

  async bulkTag(
    documentIds: Identifier[],
    tagIds: Identifier[],
    action: 'add' | 'remove',
  ): Promise<void> {
    await bulkTagDocuments({ document_ids: documentIds, tag_ids: tagIds, action });
    const idSet = new Set(documentIds);
    const tagSet = new Set(tagIds);
    this.map((doc) => {
      if (!idSet.has(doc.id as Identifier)) return undefined;
      const current = doc.tags as Identifier[] ?? [];
      let next: Identifier[];
      if (action === 'add') {
        const currentSet = new Set(current);
        next = [...current, ...tagIds.filter((id) => !currentSet.has(id))];
      } else {
        next = current.filter((id) => !tagSet.has(id));
      }
      if (next.length === current.length && next.every((id, i) => id === current[i])) return undefined;
      return { ...doc, tags: next } as T;
    });
  }

  async addCorrespondent(documentId: DocumentId, correspondentId: Identifier): Promise<void> {
    await addDocumentCorrespondent(documentId, correspondentId);
    this.update(documentId, (doc) => {
      const current = doc.correspondents ?? [];
      if (current.includes(correspondentId)) return doc;
      return { ...doc, correspondents: [...current, correspondentId] } as T;
    });
  }

  async removeCorrespondent(documentId: DocumentId, correspondentId: Identifier): Promise<void> {
    await removeDocumentCorrespondent(documentId, correspondentId);
    this.update(documentId, (doc) => {
      const current = doc.correspondents ?? [];
      const next = current.filter((id: Identifier) => id !== correspondentId);
      return next.length === current.length ? doc : ({ ...doc, correspondents: next } as T);
    });
  }

  async bulkCorrespondent(
    documentIds: Identifier[],
    assignments: Array<{ correspondent_id?: Identifier }>,
    action: 'add' | 'remove',
  ): Promise<void> {
    await assignCorrespondentsBulk({ document_ids: documentIds, assignments, action });
    const idSet = new Set(documentIds);
    const corrIds = new Set(assignments.map((a) => a.correspondent_id).filter(Boolean) as Identifier[]);
    this.map((doc) => {
      if (!idSet.has(doc.id as Identifier)) return undefined;
      const current = doc.correspondents as Identifier[] ?? [];
      let next: Identifier[];
      if (action === 'add') {
        const currentSet = new Set(current);
        next = [...current, ...Array.from(corrIds).filter((id) => !currentSet.has(id))];
      } else {
        next = current.filter((id) => !corrIds.has(id));
      }
      if (next.length === current.length && next.every((id, i) => id === current[i])) return undefined;
      return { ...doc, correspondents: next } as T;
    });
  }

  async moveToFolder(id: DocumentId, folderId: Identifier | null): Promise<void> {
    await moveDocumentToFolder(id, folderId);
  }

  async bulkMove(ids: Identifier[], folderId: Identifier | null): Promise<void> {
    await moveDocumentsBulk(ids, folderId);
  }
}

export default DocumentsManager;
