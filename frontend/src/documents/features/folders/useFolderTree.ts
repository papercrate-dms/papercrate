import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRootNode, DEFAULT_FOLDER_NAME, flattenFolderTree } from '../../../app/workspaceUtils';
import type { FolderNodeId, FolderId } from '../../../types/identifiers';
import type { FolderNode } from '../../../types/documents';
import type FoldersManager from '../../FoldersManager';

interface UseFolderTreeOptions {
  initialSelectedFolder?: FolderNodeId;
  foldersManager?: FoldersManager;
}

interface FolderOption {
  id: FolderNodeId;
  label: string;
}

const useFolderTree = ({
  initialSelectedFolder = 'root',
  foldersManager,
}: UseFolderTreeOptions) => {
  // Subscribe to manager updates
  const managerSnapshot = useSyncExternalStore(
    useCallback(cb => foldersManager ? foldersManager.subscribe(cb) : () => { }, [foldersManager]),
    () => foldersManager ? foldersManager.getSnapshot() : null,
    () => foldersManager ? foldersManager.getSnapshot() : null,
  );

  const treeSnapshot = useSyncExternalStore(
    useCallback(cb => foldersManager ? foldersManager.subscribe(cb) : () => { }, [foldersManager]),
    () => foldersManager ? foldersManager.getTreeSnapshot() : [],
    () => foldersManager ? foldersManager.getTreeSnapshot() : [],
  );

  // Track expanded state locally
  const [expandedIds, setExpandedIds] = useState<Set<FolderNodeId>>(new Set(['root']));

  // Fetch tree on mount
  useEffect(() => {
    if (foldersManager) {
      foldersManager.ensureTree().catch(err => console.error(err));
    }
  }, [foldersManager]);

  const folderNodes = useMemo(() => {
    if (!foldersManager || !managerSnapshot) {
      const rootNode = createRootNode() as FolderNode;
      return new Map([[rootNode.id, rootNode]]);
    }

    const map = new Map<FolderNodeId, FolderNode>();
    // Use the synced tree snapshot
    const roots = treeSnapshot;

    if (roots.length === 0) {
      // Return placeholder or empty
      const rootNode = createRootNode() as FolderNode;
      return new Map([[rootNode.id, rootNode]]);
    }

    const flatStructure = flattenFolderTree(roots);
    // Use the synced data snapshot
    const dataSnapshot = managerSnapshot;

    // Reconstruct the nodes integrating data from byId and structure from tree
    // plus local UI state (expanded)
    const rootChildren: FolderNodeId[] = [];

    flatStructure.forEach((item) => {
      const id = item.id as FolderNodeId;
      const data = dataSnapshot.get(id);

      // Merge: structure (children, parent) comes from flatStructure (which comes from treeSnapshot)
      // Data (name) comes from dataSnapshot (byId) to ensure renames propagate instantly
      const name = data?.name ?? item.name;
      const parentId = (item.parent_id || 'root') as FolderNodeId;
      const children = (item.children || []).map(c => c.id as FolderNodeId);

      map.set(id, {
        id,
        name,
        parentId,
        children,
        expanded: expandedIds.has(id),
        loaded: true,
        hasChildren: children.length > 0
      });

      if (parentId === 'root') {
        rootChildren.push(id);
      }
    });

    return map;
  }, [foldersManager, managerSnapshot, treeSnapshot, expandedIds]);

  const [selectedFolder, setSelectedFolder] = useState<FolderNodeId>(initialSelectedFolder || 'root');

  const isInvalidFolderDrop = useCallback(
    (sourceId: FolderNodeId | null, targetId: FolderNodeId | null) => {
      if (!sourceId) return false;
      if (!targetId || targetId === 'root') {
        return false;
      }
      if (sourceId === targetId) {
        return true;
      }

      let current = targetId;
      const visited = new Set();
      while (current && current !== 'root' && !visited.has(current)) {
        visited.add(current);
        if (current === sourceId) {
          return true;
        }
        const node = folderNodes.get(current);
        if (!node) break;
        current = (node.parentId ?? 'root') as FolderNodeId;
      }
      return false;
    },
    [folderNodes],
  );

  const resetFolderTreeState = useCallback(() => {
    setExpandedIds(new Set(['root']));
    setSelectedFolder('root');
  }, []);

  const currentFolderName = useMemo(() => {
    if (selectedFolder === 'root') return DEFAULT_FOLDER_NAME;
    if (selectedFolder === 'trash') return 'Trash';
    const node = folderNodes.get(selectedFolder);
    return node?.name || DEFAULT_FOLDER_NAME;
  }, [selectedFolder, folderNodes]);

  const folderOptions: FolderOption[] = useMemo(() => {
    const cache = new Map<FolderNodeId, string>();
    const computePath = (id: FolderNodeId | null): string => {
      if (cache.has(id as FolderNodeId)) {
        return cache.get(id as FolderNodeId) as string;
      }
      if (!id || id === 'root') {
        cache.set('root', DEFAULT_FOLDER_NAME);
        return DEFAULT_FOLDER_NAME;
      }
      const node = folderNodes.get(id);
      if (!node) {
        return 'Folder';
      }
      const parentId = (node.parentId || 'root') as FolderId;
      const parentPath = computePath(parentId);
      const name = node.name || 'Folder';
      const fullPath = parentId === 'root' ? name : `${parentPath}/${name}`;
      cache.set(id, fullPath);
      return fullPath;
    };

    const entries: FolderOption[] = [];
    folderNodes.forEach((node, id) => {
      if (!node) return;
      entries.push({ id, label: computePath(id) });
    });

    entries.sort((a, b) => {
      if (a.id === 'root') return -1;
      if (b.id === 'root') return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });

    return entries;
  }, [folderNodes]);


  const folderLabelMap = useMemo(() => {
    const map = new Map<FolderNodeId, string>();
    folderOptions.forEach((option) => {
      map.set(option.id, option.label);
    });
    return map;
  }, [folderOptions]);

  // Exposed helper to toggle expansion (if needed by consumers who can reach here)
  const toggleFolder = useCallback((folderId: FolderNodeId) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  return {
    folderNodes,
    selectedFolder,
    setSelectedFolder,
    currentFolderName,
    folderOptions,
    folderLabelMap,
    isInvalidFolderDrop,
    resetFolderTreeState,
    toggleFolder,
    setExpandedIds
  };
};

export default useFolderTree;
