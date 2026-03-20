import { useEffect, useMemo, useState } from 'react';
import type { DocumentId } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import { createDocumentEntryKey, createFolderEntryKey } from '../../app/entryKey';

interface UseWorkspaceViewDataArgs {
    documents: Document[];
    documentLookup: Map<DocumentId, Document>;
    searchResultIds: DocumentId[] | null;
    showingSearchResults: boolean;
    currentSubfolders: any[];
}

const useWorkspaceViewData = ({
    documents,
    documentLookup,
    searchResultIds,
    showingSearchResults,
    currentSubfolders,
}: UseWorkspaceViewDataArgs) => {
    const [visibleDocumentIds, setVisibleDocumentIds] = useState<DocumentId[]>([]);

    useEffect(() => {
        const arraysEqual = (a: DocumentId[], b: DocumentId[]) =>
            a.length === b.length && a.every((value, index) => value === b[index]);

        if (showingSearchResults && Array.isArray(searchResultIds)) {
            const ids = searchResultIds.filter((id): id is DocumentId => id != null);
            setVisibleDocumentIds((prev) => (arraysEqual(prev, ids) ? prev : ids));
            return;
        }

        const folderIds = documents
            .map((doc) => (doc?.id ?? null) as DocumentId | null)
            .filter((id): id is DocumentId => id != null);
        setVisibleDocumentIds((prev) => (arraysEqual(prev, folderIds) ? prev : folderIds));
    }, [showingSearchResults, searchResultIds, documents]);

    const viewDocuments = useMemo(
        () =>
            visibleDocumentIds
                .map((id) => documentLookup.get(id) || null)
                .filter((doc): doc is Document => Boolean(doc)),
        [visibleDocumentIds, documentLookup],
    );

    const visibleDocumentKeys = useMemo(
        () => visibleDocumentIds.map((id) => createDocumentEntryKey(id)).filter(Boolean),
        [visibleDocumentIds],
    );

    const visibleFolderKeys = useMemo(
        () =>
            showingSearchResults
                ? []
                : (currentSubfolders || [])
                    .map((folder: any) => createFolderEntryKey(folder.id))
                    .filter(Boolean),
        [showingSearchResults, currentSubfolders],
    );

    const visibleEntryKeys = useMemo(
        () => [...visibleFolderKeys, ...visibleDocumentKeys],
        [visibleFolderKeys, visibleDocumentKeys],
    );

    const visibleEntryKeySet = useMemo(
        () => new Set(visibleEntryKeys),
        [visibleEntryKeys],
    );

    return {
        viewDocuments,
        visibleDocumentIds,
        visibleEntryKeys,
        visibleEntryKeySet,
    };
};

export default useWorkspaceViewData;
