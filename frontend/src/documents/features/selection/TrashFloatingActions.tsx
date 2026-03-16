import React, { useMemo } from 'react';
import { TrashIcon, RestoreIcon, IconX } from '../../../components/icons';
import { useWorkspaceSelectionContext } from '../../../app/WorkspaceSelectionContext';
import { useTrashMutations } from '../../data/useTrashMutations';
import SelectionSummary from './SelectionSummary';
import type { DocumentId } from '../../../types/identifiers';

interface TrashFloatingActionsProps {
  onClearSelection?: () => void;
}

const TrashFloatingActions: React.FC<TrashFloatingActionsProps> = ({
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
