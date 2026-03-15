import React, { type DragEvent } from 'react';
import { isTagTransferEvent } from '../tagging/tagTransfer';
import type { DocumentViewLogic } from '../../logic/useDocumentViewLogic';
import { useDocumentsCommandContext } from '../../context/DocumentsCommandContext';
import { useDocumentsViewStateContext } from '../../context/DocumentsViewStateContext';
import type { RenameState } from '../../components/EditableEntryTitle';

interface UseFolderItemLogicProps {
    folder: any;
    viewLogic: DocumentViewLogic;
}

export const useFolderItemLogic = (props: UseFolderItemLogicProps) => {
    const { folder, viewLogic } = props;
    const {
        draggedFolderId,
    } = useDocumentsViewStateContext();

    const {
        folder: {
            onClick: onFolderClick,
            onSelect: onFolderSelect,
            onRename: onFolderRename,
            onDrag: {
                start: onFolderDragStart,
                end: onFolderDragEnd,
                over: onFolderDragOver,
                leave: onFolderDragLeave,
                drop: onFolderDrop,
            }
        }

    } = useDocumentsCommandContext();

    const {
        selectedFolderIdsSet,
        totalSelectionCount,
        folderRename: {
            editingId: editingFolderId,
            draftValue: folderDraft,
            setDraftValue: setFolderDraft,
            beginEditing: beginFolderEditing,
            cancelEditing: cancelFolderEditing,
            submitEditing: submitFolderEditing,
            savingId: savingFolderId,
            attachInputRef: attachFolderInputRef,
        },
    } = viewLogic;

    const canDragFolder = folder.id !== 'root';
    const isDraggingFolder = draggedFolderId === folder.id;
    const isSelectedFolder = selectedFolderIdsSet?.has(folder.id);
    const canRenameFolder = Boolean(onFolderRename) && folder.id !== 'root';
    const isFolderEditing = editingFolderId === folder.id;
    const folderDraftValue = isFolderEditing ? folderDraft : folder.name;
    const trimmedFolderDraft = isFolderEditing ? folderDraft.trim() : '';
    const isFolderSaving = savingFolderId === folder.id;
    const canSubmitFolder =
        isFolderEditing && trimmedFolderDraft.length > 0 && trimmedFolderDraft !== folder.name;
    const allowInlineFolderEdit = canRenameFolder && isSelectedFolder && totalSelectionCount === 1;

    const handlers = {
        onClick: (event: React.MouseEvent) => onFolderClick?.(folder, event),
        onDoubleClick: (event: React.MouseEvent) => {
            event.preventDefault();
            onFolderSelect?.(folder.id);
        },
        onDragOver: (event: DragEvent<HTMLElement>) => {
            if (isTagTransferEvent(event)) {
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'none';
                }
                return;
            }
            onFolderDragOver?.(event, folder.id);
        },
        onDragLeave: onFolderDragLeave,
        onDrop: (event: DragEvent<HTMLElement>) => {
            if (isTagTransferEvent(event)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            onFolderDrop?.(event, folder.id);
        },
        onDragStart: (event: DragEvent<HTMLElement>) => {
            if (canDragFolder) {
                onFolderDragStart?.(event, folder.id);
            }
        },
        onDragEnd: (event: DragEvent<HTMLElement>) => {
            if (canDragFolder) {
                onFolderDragEnd?.(event);
            }
        },
        onRenameChange: setFolderDraft,
        onRenameSubmit: () => submitFolderEditing(folder),
        onRenameCancel: (event?: React.SyntheticEvent) => cancelFolderEditing(event),
        onRenameBegin: (event: React.SyntheticEvent) => {
            if (!allowInlineFolderEdit) return;
            event.preventDefault();
            event.stopPropagation();
            beginFolderEditing(folder);
        },
    };

    const folderRenameProps: RenameState = {
        isEditing: isFolderEditing,
        draftValue: folderDraftValue,
        onChange: setFolderDraft,
        onSubmit: () => submitFolderEditing(folder),
        onCancel: (event?: React.SyntheticEvent) => cancelFolderEditing(event),
        isSaving: isFolderSaving,
        canSubmit: canSubmitFolder,
        inputRef: attachFolderInputRef,
        allowInlineEdit: allowInlineFolderEdit,
        onBeginEditing: (event: React.SyntheticEvent) => {
            if (!allowInlineFolderEdit) return;
            event.preventDefault();
            event.stopPropagation();
            beginFolderEditing(folder);
        },
    };

    return {
        canDragFolder,
        isDraggingFolder,
        isSelectedFolder,
        isFolderEditing,
        folderDraftValue,
        isFolderSaving,
        canSubmitFolder,
        allowInlineFolderEdit,
        attachFolderInputRef,
        folderRenameProps,
        handlers,
    };
};


