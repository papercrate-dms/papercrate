import React, { useCallback, useMemo } from 'react';
import { TrashIcon, RestoreIcon } from '../../../components/icons';
import { IconX } from '../../../components/icons';
import { useWorkspaceSelectionContext } from '../../../app/WorkspaceSelectionContext';
import { useDocumentsSearch } from '../../../lib/context/DocumentsSearchContext';
import { useFolderTree } from '../../../lib/context/FolderTreeContext';
import type DocumentsManager from '../../DocumentsManager';
import { restoreDocument, purgeDocument } from '../../../lib/api/apiClient';
import { useStatusToast } from '../../../lib/context/StatusToastContext';
import { useUI } from '../../../lib/context/UIContext';
import SelectionSummary from './SelectionSummary';
import type { DocumentId } from '../../../types/identifiers';
import type { Document } from '../../../types/documents';

interface TrashFloatingActionsProps {
  onClearSelection?: () => void;
}

const TrashFloatingActions: React.FC<TrashFloatingActionsProps> = ({
  onClearSelection,
}) => {
  const { documentLookup, documentsManager } = useDocumentsSearch();
  const { refreshCurrentFolder } = useFolderTree();
  const { showToast } = useStatusToast();
  const { notifyApiError } = useUI();

  const {
    selectedDocumentIds,
    clearSelection,
  } = useWorkspaceSelectionContext();

  const documentIds = useMemo<DocumentId[]>(
    () => (Array.isArray(selectedDocumentIds) ? selectedDocumentIds : []).filter(Boolean) as DocumentId[],
    [selectedDocumentIds],
  );

  const selectionCount = documentIds.length;

  const handleRestore = useCallback(async () => {
    if (!documentIds.length) return;
    try {
      await Promise.all(documentIds.map((id) => {
        const doc = documentLookup?.get(id) as Document | undefined;
        return restoreDocument(id, doc?.folder_id ?? null);
      }));
      const count = documentIds.length;
      (documentsManager as DocumentsManager)?.remove?.(documentIds);
      clearSelection();
      showToast(`Restored ${count} document${count === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notifyApiError(error, 'Failed to restore documents.');
    }
  }, [documentIds, documentLookup, clearSelection, refreshCurrentFolder, showToast, notifyApiError]);

  const handlePurge = useCallback(async () => {
    if (!documentIds.length) return;
    const count = documentIds.length;
    const confirmed = window.confirm(
      `Permanently delete ${count} document${count === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await Promise.all(documentIds.map((id) => purgeDocument(id)));
      (documentsManager as DocumentsManager)?.remove?.(documentIds);
      clearSelection();
      showToast(`Permanently deleted ${count} document${count === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notifyApiError(error, 'Failed to delete documents.');
    }
  }, [documentIds, clearSelection, refreshCurrentFolder, showToast, notifyApiError]);

  if (selectionCount === 0) {
    return null;
  }

  const handleClear = onClearSelection || clearSelection;

  return (
    <div className="panel-floating-region" aria-live="polite" aria-atomic="true">
      <div className="panel-floating">
        <span className="panel-floating__label">
          <SelectionSummary
            documentCount={selectionCount}
            folderCount={0}
            totalCount={selectionCount}
          />
        </span>
        <div className="panel-floating-actions panel-floating-actions--assignments">
          <button
            type="button"
            className="icon-button panel-floating-actions__button"
            onClick={handleRestore}
            aria-label="Restore selected documents"
            title="Restore"
          >
            <RestoreIcon className="icon-inline" />
          </button>
          <button
            type="button"
            className="icon-button danger panel-floating-actions__button"
            onClick={handlePurge}
            aria-label="Permanently delete selected documents"
            title="Delete permanently"
          >
            <TrashIcon className="icon-inline" />
          </button>
        </div>
        <div className="panel-floating__buttons">
          {handleClear ? (
            <button
              type="button"
              className="icon-button panel-floating-actions__button"
              onClick={handleClear}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <IconX className="icon-inline" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default TrashFloatingActions;
