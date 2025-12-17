import { shallowEqual } from 'react-redux';
import type { DocumentId, Identifier, TagId } from '../types/identifiers';
import type { Tag, Correspondent } from '../types/documents';
import type TagManager from '../lib/assets/TagManager';
import type CorrespondentManager from '../lib/assets/CorrespondentManager';

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

      if (this.correspondentManager && Array.isArray((doc as any).correspondents)) {
        const rawCorrespondents = (doc as any).correspondents as any[];
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
    const next = new Map<DocumentId, T>();
    this.byId.forEach((doc, key) => {
      const updated = mapper(doc);
      const nextDoc = updated === undefined ? doc : updated;
      if (nextDoc !== doc) {
        changed = true;
      }
      next.set(key, nextDoc ?? doc);
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

  getSnapshot(): Map<DocumentId, T> {
    return this.byId;
  }
}

export default DocumentsManager;
