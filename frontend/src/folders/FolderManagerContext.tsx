import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_FOLDER_NAME } from '../app/workspaceUtils';

type FolderId = string | null;

interface FolderManager {
  getNameSync: (folderId: FolderId) => string | null;
  resolveName: (folderId: FolderId) => Promise<string>;
}

const defaultManager: FolderManager = {
  getNameSync: (folderId) => (folderId == null ? DEFAULT_FOLDER_NAME : `Folder ${folderId}`),
  resolveName: async (folderId) => (folderId == null ? DEFAULT_FOLDER_NAME : `Folder ${folderId}`),
};

const FolderManagerContext = createContext<FolderManager>(defaultManager);

interface FolderManagerProviderProps {
  folderNodes?: Map<string | 'root', { name?: string | null }>;
  ensureFolderData?: (folderId: FolderId | 'root', options?: { force?: boolean; includeDocuments?: boolean }) => Promise<void>;
  children: ReactNode;
}

export const FolderManagerProvider: React.FC<FolderManagerProviderProps> = ({
  folderNodes,
  ensureFolderData,
  children,
}) => {
  const value = useMemo<FolderManager>(() => {
    if (!folderNodes) {
      return defaultManager;
    }

    const getNameSync = (folderId: FolderId) => {
      if (folderId == null) return DEFAULT_FOLDER_NAME;
      return folderNodes.get(folderId)?.name ?? null;
    };

    const resolveName = async (folderId: FolderId) => {
      const cached = getNameSync(folderId);
      if (cached) return cached;
      if (folderId == null) return DEFAULT_FOLDER_NAME;
      if (ensureFolderData) {
        await ensureFolderData(folderId, { includeDocuments: false });
        return getNameSync(folderId) ?? `Folder ${folderId}`;
      }
      return `Folder ${folderId}`;
    };

    return { getNameSync, resolveName };
  }, [folderNodes, ensureFolderData]);

  return (
    <FolderManagerContext.Provider value={value}>
      {children}
    </FolderManagerContext.Provider>
  );
};

export const useFolderManager = (): FolderManager => useContext(FolderManagerContext);
