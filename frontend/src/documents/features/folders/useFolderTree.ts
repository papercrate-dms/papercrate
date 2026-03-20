import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRootNode, DEFAULT_FOLDER_NAME, flattenFolderTree } from '../../../app/workspaceUtils';
import type { FolderNodeId, FolderId } from '../../../types/identifiers';
import type { FolderNode } from '../../../types/documents';
import type FoldersManager from '../../FoldersManager';

interface UseFolderTreeOptions {
  initialSelectedFolder?: FolderNodeId;
  foldersManager?: FoldersManager;
  /** When provided, selectedFolder state is controlled externally (owned by the caller). */
  externalSelectedFolder?: FolderNodeId;
  externalSetSelectedFolder?: React.Dispatch<React.SetStateAction<FolderNodeId>>;
}

interface FolderOption {
  id: FolderNodeId;
  label: string;
}

const useFolderTree = ({
  initialSelectedFolder = 'root',
  foldersManager,
  externalSelectedFolder,
  externalSetSelectedFolder,
}: UseFolderTreeOptions) => {
  // Subscribe to manager updates
  const combined = useSyncExternalStore(
    useCallback(cb => foldersManager ? foldersManager.subscribe(cb) : () => { }, [foldersManager]),
    () => foldersManager ? foldersManager.getCombinedSnapshot() : null,
    () => foldersManager ? foldersManager.getCombinedSnapshot() : null,
  );
  const managerSnapshot = combined?.byId ?? null;
  const treeSnapshot = combined?.tree ?? [];

  // Track expanded state locally
  const [expandedIds, setExpandedIds] = useState<Set<FolderNodeId>>(new Set(['root']));

  // Fetch tree on mount
  useEffect(() => {
    if (foldersManager) {
      foldersManager.ensureTree().catch(err => console.error(err));
    }
  }, [foldersManager]);

  const folderNodesRaw = useMemo(() => {
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


    });

    return map;
  }, [foldersManager, managerSnapshot, treeSnapshot, expandedIds]);

  // Stabilize identity: reuse the previous Map if the content hasn't changed.
  // This prevents downstream callbacks/memos from recreating when a manager
  // notification fires but no actual folder data changed.
  const prevFolderNodesRef = useRef(folderNodesRaw);
  const folderNodes = useMemo(() => {
    const prev = prevFolderNodesRef.current;
    if (prev.size !== folderNodesRaw.size) {
      prevFolderNodesRef.current = folderNodesRaw;
      return folderNodesRaw;
    }
    for (const [id, node] of folderNodesRaw) {
      const prevNode = prev.get(id);
      if (!prevNode
        || prevNode.name !== node.name
        || prevNode.parentId !== node.parentId
        || prevNode.expanded !== node.expanded
        || prevNode.children.length !== node.children.length
      ) {
        prevFolderNodesRef.current = folderNodesRaw;
        return folderNodesRaw;
      }
    }
    return prev;
  }, [folderNodesRaw]);

  // When external state is provided, use it; otherwise own the state locally.
  const [localSelectedFolder, localSetSelectedFolder] = useState<FolderNodeId>(initialSelectedFolder || 'root');
  const selectedFolder = externalSelectedFolder ?? localSelectedFolder;
  const setSelectedFolder = externalSetSelectedFolder ?? localSetSelectedFolder;

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

  // Single-pass derivation of both folderOptions (sorted array) and folderLabelMap (lookup).
  const { folderOptions, folderLabelMap } = useMemo(() => {
    const cache = new Map<FolderNodeId, string>();
    const computePath = (id: FolderNodeId | null): string => {
      if (cache.has(id as FolderNodeId)) return cache.get(id as FolderNodeId) as string;
      if (!id || id === 'root') { cache.set('root', DEFAULT_FOLDER_NAME); return DEFAULT_FOLDER_NAME; }
      const node = folderNodes.get(id);
      if (!node) return 'Folder';
      const parentId = (node.parentId || 'root') as FolderId;
      const fullPath = parentId === 'root' ? (node.name || 'Folder') : `${computePath(parentId)}/${node.name || 'Folder'}`;
      cache.set(id, fullPath);
      return fullPath;
    };

    const entries: FolderOption[] = [];
    const labelMap = new Map<FolderNodeId, string>();
    folderNodes.forEach((node, id) => {
      if (!node) return;
      const label = computePath(id);
      entries.push({ id, label });
      labelMap.set(id, label);
    });

    entries.sort((a, b) => {
      if (a.id === 'root') return -1;
      if (b.id === 'root') return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });

    return { folderOptions: entries, folderLabelMap: labelMap };
  }, [folderNodes]);

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
