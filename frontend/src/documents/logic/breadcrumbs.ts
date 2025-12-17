import type { FolderNode } from '../../types/documents';
import type { FolderNodeId } from '../../types/identifiers';

export const resolveBreadcrumbs = (
    startFolderId: FolderNodeId,
    folderNodes: Map<FolderNodeId, FolderNode>
): FolderNode[] => {
    const chain: FolderNode[] = [];
    const seen = new Set<FolderNodeId>();
    let currentId: FolderNodeId | null = startFolderId;
    let guard = 0;

    while (currentId && !seen.has(currentId) && guard < 64) {
        guard += 1;
        seen.add(currentId);

        const node = folderNodes.get(currentId);
        if (node) {
            chain.push(node);
            currentId = node.parentId as FolderNodeId;
        } else {
            break;
        }
    }

    const ordered: FolderNode[] = [];
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
