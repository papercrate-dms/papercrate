import React, { useMemo } from 'react';
import { TrashIcon, RestoreIcon, IconX } from '../../../components/icons';
import { useWorkspaceSelectionContext } from '../../../app/WorkspaceSelectionContext';
import { useTrashMutations } from '../../data/useTrashMutations';
import SelectionSummary from './SelectionSummary';
import type { DocumentId } from '../../../types/identifiers';

interface SelectionActionsTrashProps {
  onClearSelection?: () => void;
}

const SelectionActionsTrash: React.FC<SelectionActionsTrashProps> = ({
  onClearSelection,
}) => {
  const { restoreDocuments, purgeDocuments } = useTrashMutations();
  const { selectedDocumentIds, clearSelection } = useWorkspaceSelectionContext();

  const documentIds = useMemo<DocumentId[]>(
    () => (Array.isArray(selectedDocumentIds) ? selectedDocumentIds : []).filter(Boolean) as DocumentId[],
    [selectedDocumentIds],
  );

  const selectionCount = documentIds.length;

  if (selectionCount === 0) {
    return null;
  }

  const handleRestore = async () => {
    await restoreDocuments(documentIds);
    clearSelection();
  };

  const handlePurge = async () => {
    await purgeDocuments(documentIds);
    clearSelection();
  };

  const handleClear = onClearSelection || clearSelection;

  return (
    <>
      <SelectionSummary
        documentCount={selectionCount}
        folderCount={0}
        totalCount={selectionCount}
      />
      <span className="actions-divider" aria-hidden="true" />
      <span className="selection-actions-right">
        <button
          type="button"
          className="icon-button selection-action"
          onClick={handleRestore}
          aria-label="Restore selected documents"
          title="Restore"
        >
          <RestoreIcon className="icon-inline" />
        </button>
        <button
          type="button"
          className="icon-button danger selection-action"
          onClick={handlePurge}
          aria-label="Permanently delete selected documents"
          title="Delete permanently"
        >
          <TrashIcon className="icon-inline" />
        </button>
        {handleClear ? (
          <>
            <span className="actions-divider" aria-hidden="true" />
            <button
              type="button"
              className="icon-button selection-action"
              onClick={handleClear}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <IconX className="icon-inline" />
            </button>
          </>
        ) : null}
      </span>
    </>
  );
};

export default SelectionActionsTrash;
