import { useCallback } from 'react';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import type { Identifier } from '../../types/identifiers';
import type { MessageOptions } from '../../types/documents';


interface UseBulkDocumentActionsArgs {
  selectedDocumentIds?: Identifier[];
  selectedFolderIds?: Identifier[];
  handleDocumentsDelete: (ids: Identifier[], options?: MessageOptions) => Promise<boolean>;
  handleFolderDelete: (id: Identifier, options?: MessageOptions) => Promise<boolean>;
  clearSelection: () => void;
}

const useBulkDocumentActions = ({
  selectedDocumentIds,
  selectedFolderIds,
  handleDocumentsDelete,
  handleFolderDelete,
  clearSelection,
}: UseBulkDocumentActionsArgs) => {
  const { showToast } = useStatusToast();

  /*
   * Bulk Deletion Logic (Handles both Documents and Folders)
   * Moved other bulk actions to useDocumentMutations to resolve circular dependencies.
   */
  const handleDeleteSelection = useCallback(async () => {
    const docIds = Array.isArray(selectedDocumentIds) ? selectedDocumentIds : [];
    const folderIds = Array.isArray(selectedFolderIds) ? selectedFolderIds : [];

    if (docIds.length === 0 && folderIds.length === 0) {
      return;
    }

    const parts = [];
    if (docIds.length) {
      parts.push(`${docIds.length} document${docIds.length === 1 ? '' : 's'}`);
    }
    if (folderIds.length) {
      parts.push(`${folderIds.length} folder${folderIds.length === 1 ? '' : 's'}`);
    }
    const descriptor = parts.join(' and ');
    const confirmation = `Delete ${descriptor}? Folders must be empty before deletion. You can restore documents later from trash.`;

    if (!window.confirm(confirmation)) {
      return;
    }

    let docsOk = true;
    let foldersOk = true;

    if (docIds.length) {
      docsOk = await handleDocumentsDelete(docIds, { showMessage: false });
    }

    if (folderIds.length) {
      for (const folderId of folderIds) {
        const success = await handleFolderDelete(folderId, { showMessage: false });
        if (!success) {
          foldersOk = false;
        }
      }
    }

    if (!docsOk || !foldersOk) {
      showToast('Some items could not be deleted. Ensure folders are empty before deletion.', 'error');
      return;
    }

    clearSelection();

    const successParts = [];
    if (docIds.length) {
      successParts.push(docIds.length === 1 ? 'Document deleted.' : 'Documents deleted.');
    }
    if (folderIds.length) {
      successParts.push(folderIds.length === 1 ? 'Folder deleted.' : 'Folders deleted.');
    }

    showToast(successParts.join(' '), 'success');
  }, [
    clearSelection,
    handleDocumentsDelete,
    handleFolderDelete,
    selectedDocumentIds,
    selectedFolderIds,
    showToast,
  ]);

  return {
    handleDeleteSelection,
  };
};

export default useBulkDocumentActions;
