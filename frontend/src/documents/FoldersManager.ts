import { shallowEqual } from 'react-redux';
import type { FolderNodeId } from '../types/identifiers';
import type { Folder } from '../types/documents';
import { createRootNode } from '../app/workspaceUtils';

import type { FolderTreeNode, FolderInfo } from '../lib/api/apiTypes';
import {
    createFolder as apiCreateFolder,
    deleteFolder as apiDeleteFolder,
    moveFolder as apiMoveFolder,
    renameFolder as apiRenameFolder,
    getFolderTree
} from '../lib/api/apiClient';
import { flattenFolderTree } from '../app/workspaceUtils';

type FetchFolder = (id: FolderNodeId) => Promise<unknown>;

class FoldersManager {
    private byId: Map<FolderNodeId, Folder>;
    private fetcher?: FetchFolder;
    private inflight: Map<FolderNodeId, Promise<Folder | null>>;
    private treePromise: Promise<FolderTreeNode[]> | null = null;
    private treeSnapshot: FolderTreeNode[] = [];
    private listeners: Set<() => void>;
    private emitScheduled: boolean;


    constructor(
        fetchFolder?: FetchFolder,
    ) {
        this.byId = new Map();
        this.fetcher = fetchFolder;
        this.inflight = new Map();
        this.listeners = new Set();
        this.emitScheduled = false;
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

    setFetcher(fetchFolder?: FetchFolder) {
        this.fetcher = fetchFolder;
    }

    ingest(rawFolders: unknown[] = []): { canonical: Folder[]; changed: boolean } {
        const result = this.ingestInternal(rawFolders);
        if (result.changed) {
            this.emit();
        }
        return result;
    }

    private ingestInternal(rawFolders: unknown[] = []): { canonical: Folder[]; changed: boolean } {
        const folders = rawFolders.map((f) => f as Folder).filter(Boolean);
        let changed = false;
        let nextById = this.byId;
        const canonical: Folder[] = [];

        folders.forEach((folder) => {
            const id = folder?.id;
            if (id == null) {
                canonical.push(folder);
                return;
            }

            const existing = nextById.get(id as FolderNodeId);
            const merged = existing ? ({ ...existing, ...folder } as Folder) : ({ ...(folder as Folder) } as Folder);
            const useExisting = existing && shallowEqual(existing, merged);
            const nextFolder = useExisting ? (existing as Folder) : merged;

            if (!useExisting) {
                if (!changed) {
                    nextById = new Map(this.byId);
                }
                nextById.set(id as FolderNodeId, nextFolder);
                changed = true;
            }
            canonical.push(nextFolder);
        });

        if (changed) {
            this.byId = nextById;
        }

        return { canonical, changed };
    }

    async ensure(id: FolderNodeId, fetcherOverride?: FetchFolder): Promise<Folder | null> {
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

    map(mapper: (folder: Folder) => Folder | undefined): boolean {
        if (!this.byId.size) {
            return false;
        }

        let changed = false;
        const next = new Map<FolderNodeId, Folder>();
        this.byId.forEach((folder, key) => {
            const updated = mapper(folder);
            const nextFolder = updated === undefined ? folder : updated;
            if (nextFolder !== folder) {
                changed = true;
            }
            next.set(key, nextFolder ?? folder);
        });

        if (changed) {
            this.byId = next;
            this.emit();
        }

        return changed;
    }

    remove(ids: Array<FolderNodeId>): boolean {
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

    async create(name: string, parentId: FolderNodeId | null): Promise<Folder> {
        const payload = {
            name,
            parent_id: parentId === 'root' ? null : parentId
        };
        const response = await apiCreateFolder(payload);
        const folderData = response.folder as unknown as Folder;

        if (!folderData?.id) {
            throw new Error('Folder creation failed: No ID returned');
        }

        this.addNode(folderData);
        return folderData;
    }

    async delete(id: FolderNodeId): Promise<void> {
        await apiDeleteFolder(id);
        this.removeNode(id);
    }

    async rename(id: FolderNodeId, name: string): Promise<void> {
        await apiRenameFolder(id, name);

        // Update local state
        const existing = this.byId.get(id);
        if (existing) {
            this.ingest([{ ...existing, name }]);
        }

        // Update tree node
        const node = this.findNode(this.treeSnapshot, id);
        if (node) {
            node.name = name;
            this.emit();
        }
    }

    async move(id: FolderNodeId, parentId: FolderNodeId | null): Promise<void> {
        const targetParentId = parentId === 'root' ? null : parentId;
        await apiMoveFolder(id, targetParentId);

        // Update local state 'parent_id'
        const existing = this.byId.get(id);
        if (existing) {
            this.ingest([{ ...existing, parent_id: targetParentId }]);
        }

        this.moveNode(id, parentId);
    }

    private moveNode(id: FolderNodeId, parentId: FolderNodeId | null) {
        const node = this.findNode(this.treeSnapshot, id);
        if (!node) return;

        this.removeNodeFromParent(this.treeSnapshot, id);

        node.parent_id = (parentId as string) || null;

        const attachToRoot = !parentId || parentId === 'root';
        if (attachToRoot) {
            const root = this.treeSnapshot[0];
            if (root) {
                root.children = [...(root.children || []), node];
                root.hasChildren = true;
            }
        } else {
            const newParent = this.findNode(this.treeSnapshot, parentId);
            if (newParent) {
                newParent.children = [...(newParent.children || []), node];
                newParent.hasChildren = true;
            }
        }
        this.emit();
    }

    private removeNodeFromParent(nodes: FolderTreeNode[], id: FolderNodeId): boolean {
        for (const node of nodes) {
            if (node.children) {
                const idx = node.children.findIndex(c => c.id === id);
                if (idx !== -1) {
                    node.children.splice(idx, 1);
                    if (node.children.length === 0) {
                        node.hasChildren = false;
                    }
                    return true;
                }
                if (this.removeNodeFromParent(node.children, id)) {
                    return true;
                }
            }
        }
        return false;
    }

    getById(id: FolderNodeId): Folder | null {
        return this.byId.get(id) ?? null;
    }

    getMany(ids: Array<FolderNodeId> = []): Folder[] {
        return ids
            .map((id) => this.byId.get(id) || null)
            .filter((folder): folder is Folder => Boolean(folder));
    }

    getSnapshot(): Map<FolderNodeId, Folder> {
        return this.byId;
    }

    getTreeSnapshot(): FolderTreeNode[] {
        return this.treeSnapshot;
    }

    async ensureTree(): Promise<FolderTreeNode[]> {
        if (this.treeSnapshot.length > 0) {
            return this.treeSnapshot;
        }

        if (this.treePromise) {
            return this.treePromise;
        }

        this.treePromise = this.fetchTreeInternal();
        return this.treePromise;
    }

    async refreshTree(): Promise<FolderTreeNode[]> {
        this.treePromise = this.fetchTreeInternal();
        return this.treePromise;
    }

    private async fetchTreeInternal(): Promise<FolderTreeNode[]> {
        try {
            const raw = await getFolderTree();
            const flattened = flattenFolderTree(raw);
            this.ingest(flattened);
            const rootsPromises = raw as FolderTreeNode[];
            const rootNode = createRootNode() as FolderTreeNode;

            rootNode.children = rootsPromises;
            rootNode.hasChildren = rootsPromises.length > 0;
            rootNode.loaded = true;

            this.treeSnapshot = [rootNode];
            this.emit();
            return [rootNode];
        } catch (error) {
            console.warn('Failed to fetch folder tree', error);
            // On error, do not clear existing snapshot if this was a refresh
            return this.treeSnapshot.length > 0 ? this.treeSnapshot : [];
        } finally {
            this.treePromise = null;
        }
    }

    addNode(folder: Folder) {
        this.ingest([folder]);

        const newNode: FolderTreeNode = {
            ...(folder as unknown as FolderInfo),
            children: [],
            hasChildren: false,
            loaded: true,
        };

        const parentId = folder.parent_id;
        if (!parentId || parentId === 'root') {
            const root = this.treeSnapshot[0];
            if (root) {
                root.children = [...(root.children || []), newNode];
                root.hasChildren = true;
            }
        } else {
            const parent = this.findNode(this.treeSnapshot, parentId);
            if (parent) {
                parent.children = [...(parent.children || []), newNode];
                parent.hasChildren = true;
            }
        }
        this.emit();
    }

    removeNode(id: FolderNodeId) {
        this.remove([id]);

        // The treeSnapshot usually contains one root node which holds the tree
        const changed = this.removeNodeFromParent(this.treeSnapshot, id);
        if (changed) {
            this.emit();
        }
    }

    private findNode(nodes: FolderTreeNode[], id: FolderNodeId): FolderTreeNode | null {
        for (const node of nodes) {
            if (node.id === id) {
                return node;
            }
            if (node.children) {
                const found = this.findNode(node.children, id);
                if (found) return found;
            }
        }
        return null;
    }


}

export default FoldersManager;
