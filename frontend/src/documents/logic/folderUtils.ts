import type { FolderNodeId } from '../../types/identifiers';
import type { Folder } from '../../types/documents';

/**
 * Derive visible subfolders for a given selected folder from the folders snapshot.
 * Pure function — shared between FolderProvider and the workspace orchestrator
 * to guarantee identical derivation logic.
 */
export const getVisibleSubfolders = (
  foldersSnapshot: Map<string, Folder>,
  selectedFolder: FolderNodeId,
): Folder[] => {
  const currentId = selectedFolder || 'root';
  const allFolders = Array.from(foldersSnapshot.values());
  return allFolders.filter((folder: Folder) => {
    const parentId = folder.parent_id || 'root';
    return parentId === currentId;
  });
};
