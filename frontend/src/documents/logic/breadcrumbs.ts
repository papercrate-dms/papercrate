import type { FolderNodeId } from '../../types/identifiers';

/** Minimal shape accepted by resolveBreadcrumbs — works with both FolderNode and Folder. */
interface BreadcrumbNode {
    id: FolderNodeId;
    name: string;
    parentId?: FolderNodeId | string | null;
    parent_id?: FolderNodeId | string | null;
}

export interface BreadcrumbEntry {
    id: FolderNodeId;
    name: string;
}

export const resolveBreadcrumbs = (
    startFolderId: FolderNodeId,
    folderNodes: Map<FolderNodeId | string, BreadcrumbNode>
): BreadcrumbEntry[] => {
    const chain: BreadcrumbEntry[] = [];
    const seen = new Set<FolderNodeId | string>();
    let currentId: FolderNodeId | string | null = startFolderId;
    let guard = 0;

    while (currentId && !seen.has(currentId) && guard < 64) {
        guard += 1;
        seen.add(currentId);

        const node = folderNodes.get(currentId);
        if (node) {
            chain.push({ id: node.id, name: node.name });
            currentId = (node.parentId ?? node.parent_id ?? null) as FolderNodeId | null;
        } else {
            break;
        }
    }

    const ordered: BreadcrumbEntry[] = [];
    const seenOrdered = new Set<FolderNodeId>();

    for (let i = chain.length - 1; i >= 0; i--) {
        const crumb = chain[i];
        if (!seenOrdered.has(crumb.id)) {
            seenOrdered.add(crumb.id);
            ordered.push(crumb);
        }
    }

    return ordered;
};
