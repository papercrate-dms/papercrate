import { useCallback } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import useNotifyApiError from '../../hooks/useNotifyApiError';
import { DEFAULT_FOLDER_NAME } from '../../app/workspaceUtils';
import { getEntryId, isDocumentEntry } from '../../app/entryKey';
import {
    moveDocumentsBulk,
    moveDocumentToFolder,
    listFolderContents,
} from '../../lib/api/apiClient';
import type { DocumentId, FolderNodeId } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import type {
    DocumentsState,
    FolderState,
    SelectionState,
} from '../types/workspaceTypes';

type NullableFolderId = FolderNodeId | null;

interface UseDocumentMoveMutationsArgs {
    documentsState: DocumentsState;
    folderState: FolderState;
    selectionState: SelectionState;
}

export const useDocumentMoveMutations = ({
    documentsState,
    folderState,
    selectionState,
}: UseDocumentMoveMutationsArgs) => {
    const { showToast } = useStatusToast();
    const notifyApiError = useNotifyApiError();

    const normalizeDocumentId = (value: unknown): DocumentId | null => {
        if (!value) return null;
        if (value && typeof value === 'object' && 'id' in value && value.id != null) {
            return value.id as DocumentId;
        }
        return value as DocumentId;
    };

    const moveDocumentsToFolder = useCallback(
        async (documentIds: Array<DocumentId | Document>, targetFolderId?: NullableFolderId) => {
            const uniqueIds = Array.from(
                new Set((documentIds || []).map((value) => normalizeDocumentId(value)).filter(Boolean) as DocumentId[]),
            );
            if (!uniqueIds.length) return;

            const uniqueIdSet = new Set(uniqueIds);
            const target = targetFolderId === 'root' ? null : targetFolderId ?? null;
            const targetLabel =
                target === null ? DEFAULT_FOLDER_NAME : folderState.folderLabelMap.get(targetFolderId as FolderNodeId) || 'target folder';

            const movedDocs = uniqueIds
                .map((id) => {
                    const doc = documentsState.documentLookup.get(id) || null;
                    if (!doc) {
                        return null;
                    }
                    return {
                        id,
                        sourceFolderId: (doc.folder_id ?? null) as NullableFolderId,
                        document: doc,
                    };
                })
                .filter(Boolean) as Array<{ id: DocumentId; sourceFolderId: NullableFolderId; document: Document }>;

            const updatedDocsMap = new Map<DocumentId, Document>();
            const resolveTargetName = () => {
                if (!targetLabel) {
                    return null;
                }
                const segments = String(targetLabel).split('/');
                return segments[segments.length - 1] || targetLabel;
            };
            const targetName = resolveTargetName();

            movedDocs.forEach(({ id, document }) => {
                if (!document) {
                    return;
                }
                const updated: Document = {
                    ...document,
                    folder_id: target,
                };
                if (targetLabel) {
                    updated.folder_path = targetLabel;
                    if (targetName) {
                        updated.folder_name = targetName;
                    }
                } else if (target === null) {
                    updated.folder_path = DEFAULT_FOLDER_NAME;
                    updated.folder_name = DEFAULT_FOLDER_NAME;
                }
                updatedDocsMap.set(id, updated);
            });


            try {
                if (uniqueIds.length === 1) {
                    await moveDocumentToFolder(uniqueIds[0], target);
                } else {
                    await moveDocumentsBulk(uniqueIds, target);
                }

                const count = uniqueIds.length;
                const suffix = count === 1 ? '' : 's';
                showToast(`Moved ${count} document${suffix} to ${targetLabel}.`, 'success');

                // Remove moved documents from the current folder view
                documentsState.documentsManager.remove(uniqueIds);

                if (uniqueIdSet.size) {
                    const pruneRow = (rows: string[]) => rows.filter(id => !uniqueIdSet.has(getEntryId(id) as DocumentId));
                    const { selectionOrderRef, selectionAnchorRef, setSelectionOrder, setFocusedDocumentId, setFocusedEntryKey, setSelectedEntries } = selectionState;

                    setSelectedEntries((prev) => pruneRow(prev));
                    setSelectionOrder((prev) => pruneRow(prev));

                    const nextSelectionOrder = pruneRow(selectionOrderRef.current || []);
                    selectionOrderRef.current = nextSelectionOrder;

                    if (
                        selectionAnchorRef.current &&
                        isDocumentEntry(selectionAnchorRef.current) &&
                        uniqueIdSet.has(getEntryId(selectionAnchorRef.current) as DocumentId)
                    ) {
                        selectionAnchorRef.current = null;
                    }
                    if (
                        selectionState.focusedDocumentId &&
                        uniqueIdSet.has(selectionState.focusedDocumentId)
                    ) {
                        setFocusedDocumentId(null);
                    }
                    if (
                        selectionState.focusedEntryKey &&
                        isDocumentEntry(selectionState.focusedEntryKey) &&
                        uniqueIdSet.has(getEntryId(selectionState.focusedEntryKey) as DocumentId)
                    ) {
                        setFocusedEntryKey(null);
                    }
                }

                if (targetFolderId && targetFolderId !== folderState.selectedFolder) {
                    await listFolderContents(targetFolderId as FolderNodeId);
                }

            } catch (error) {
                const message = (error as Record<string, any>)?.response?.data?.error || 'Failed to move documents.';
                notifyApiError(error, message);
            }
        },
        [
            documentsState,
            folderState.folderLabelMap,
            folderState.selectedFolder,
            selectionState,
            notifyApiError,
            showToast,
        ],
    );

    return { moveDocumentsToFolder };
};
