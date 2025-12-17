import { useMemo } from 'react';
import { useWorkspaceSelectionContext } from '../../app/WorkspaceSelectionContext';
import useInlineRename from '../features/renaming/useInlineRename';
import type { Document, Folder } from '../../types/documents';

interface UseDocumentViewLogicProps {
    onDocumentRename?: (id: string, name: string) => Promise<boolean> | boolean;
    onFolderRename?: (id: string, name: string) => Promise<boolean> | boolean;
}

export const useDocumentViewLogic = ({
    onDocumentRename,
    onFolderRename,
}: UseDocumentViewLogicProps) => {
    const {
        selectedDocumentIds,
        selectedFolderIds,
        clearSelection,
        handleEntrySelection,
    } = useWorkspaceSelectionContext();

    const selectedDocumentIdsSet = useMemo(() => new Set(selectedDocumentIds), [selectedDocumentIds]);
    const selectedFolderIdsSet = useMemo(
        () => new Set(selectedFolderIds || []),
        [selectedFolderIds],
    );

    const documentSelectionCount = selectedDocumentIdsSet.size;
    const folderSelectionCount = selectedFolderIdsSet.size;
    const totalSelectionCount = documentSelectionCount + folderSelectionCount;

    const documentRename = useInlineRename<Document>(onDocumentRename, {
        getCurrentValue: (doc: Document) => doc?.title ?? '',
        getEntityId: (doc: Document) => doc?.id ?? null,
    });

    const folderRename = useInlineRename<Folder>(onFolderRename, {
        getCurrentValue: (folder: Folder) => folder?.name ?? '',
        getEntityId: (folder: Folder) => folder?.id ?? null,
    });

    return {
        selectedDocumentIdsSet,
        selectedFolderIdsSet,
        clearSelection,
        handleEntrySelection,
        totalSelectionCount,
        documentRename,
        folderRename,
    };
};

export type DocumentViewLogic = ReturnType<typeof useDocumentViewLogic>;
