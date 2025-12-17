import { listCorrespondents, createCorrespondent, updateCorrespondent, deleteCorrespondent } from '../api/apiClient';
import type { Identifier } from '../../types/identifiers';
import type { Correspondent } from '../../types/documents';

interface CorrespondentPayload {
    name: string;
}

type Listener = () => void;

class CorrespondentManager {
    private byId: Map<Identifier, Correspondent> = new Map();
    private listeners: Set<Listener> = new Set();
    private correspondentsPromise: Promise<Correspondent[]> | null = null;
    private loaded = false;

    constructor() {
        // No specific options for now
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

    getSnapshot(): Map<Identifier, Correspondent> {
        return this.byId;
    }

    ingest(correspondents: Correspondent[]): void {
        let changed = false;
        let nextMap: Map<Identifier, Correspondent> | null = null;

        correspondents.forEach((corr) => {
            if (!corr.id) return;
            const existing = this.byId.get(corr.id);
            if (JSON.stringify(existing) !== JSON.stringify(corr)) {
                if (!nextMap) nextMap = new Map(this.byId);
                nextMap.set(corr.id, corr);
                changed = true;
            }
        });

        if (changed && nextMap) {
            this.byId = nextMap;
            this.emit();
        }
    }

    remove(ids: Identifier[]): void {
        let changed = false;
        let nextMap: Map<Identifier, Correspondent> | null = null;

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

    async ensureAll(force = false): Promise<Correspondent[]> {
        if (this.loaded && !force && this.byId.size > 0) {
            return Array.from(this.byId.values());
        }

        if (this.correspondentsPromise && !force) {
            return this.correspondentsPromise;
        }

        this.correspondentsPromise = this.fetchCorrespondentsInternal();
        return this.correspondentsPromise;
    }

    private async fetchCorrespondentsInternal(): Promise<Correspondent[]> {
        try {
            const results = await listCorrespondents();
            const castResults = (results || []) as unknown as Correspondent[];
            this.byId = new Map(); // Reset
            castResults.forEach(item => {
                if (item.id) this.byId.set(item.id, item);
            });
            // Emit needed for full refresh
            this.emit();
            this.loaded = true;
            return castResults;
        } catch (error) {
            console.warn('Failed to fetch correspondents', error);
            return [];
        } finally {
            this.correspondentsPromise = null;
        }
    }

    async create(payload: CorrespondentPayload): Promise<Correspondent> {
        const response = await createCorrespondent(payload);
        const newEntry = response as unknown as Correspondent;
        this.ingest([newEntry]);
        return newEntry;
    }

    async update(id: Identifier, changes: Partial<CorrespondentPayload>): Promise<void> {
        await updateCorrespondent(id, changes);
        const existing = this.byId.get(id);
        if (existing) {
            const updated = { ...existing, ...changes };
            this.ingest([updated as Correspondent]);
        } else {
            this.ensureAll(true);
        }
    }

    async delete(id: Identifier): Promise<void> {
        await deleteCorrespondent(id);
        this.remove([id]);
    }

    normalizeName(name?: string | null): string {
        return name?.trim?.() || '';
    }

    buildPayload({ name }: { name?: string | null } = {}): CorrespondentPayload {
        const normalizedName = this.normalizeName(name);
        if (!normalizedName) {
            throw new Error('Correspondent name is required.');
        }
        return {
            name: normalizedName,
        };
    }
}

export default CorrespondentManager;
