import React, { type DragEvent } from 'react';
import { createDocumentEntryKey } from '../../app/entryKey';
import { useDocumentOpen } from '../../lib/context/DocumentOpenContext';
import type { Document } from '../../types/documents';
import { useDocumentsCommandContext } from '../context/DocumentsCommandContext';
import { useDocumentsViewStateContext } from '../context/DocumentsViewStateContext';
import type { DocumentViewLogic } from './useDocumentViewLogic';
import { TagInteractionHandlers } from '../interactions/useTagInteractions';
import type { RenameState } from '../components/EditableEntryTitle';

interface UseDocumentItemLogicArgs {
    doc: Document;
    tagHandlers?: TagInteractionHandlers;
    viewLogic: DocumentViewLogic; // Retained from original props
}

export const useDocumentItemLogic = ({ doc, tagHandlers, viewLogic }: UseDocumentItemLogicArgs) => {
    const {
        draggingDocumentIdsSet
    } = useDocumentsViewStateContext();

    const {
        document: {
            onDrag: { start: onDocumentDragStart, end: onDocumentDragEnd },
            onRename: onDocumentRename
        },
        onEntryPointer
    } = useDocumentsCommandContext();

    const {
        selectedDocumentIdsSet,
        totalSelectionCount,
        documentRename: {
            editingId: editingDocumentId,
            draftValue: documentDraft,
            setDraftValue: setDocumentDraft,
            beginEditing: beginDocumentEditing,
            cancelEditing: cancelDocumentEditing,
            submitEditing: submitDocumentEditing,
            savingId: savingDocumentId,
            attachInputRef: attachDocumentInputRef,
        },
        handleEntrySelection,
    } = viewLogic;

    const isSelected = selectedDocumentIdsSet?.has(doc.id);
    const isDraggingDoc = draggingDocumentIdsSet?.has(doc.id);
    const isEditingDoc = editingDocumentId === doc.id;
    const documentDraftValue = isEditingDoc ? documentDraft : doc.title;
    const trimmedDocumentDraft = isEditingDoc ? documentDraft.trim() : '';
    const isDocumentSaving = savingDocumentId === doc.id;
    const canSubmitDocument =
        isEditingDoc && trimmedDocumentDraft.length > 0 && trimmedDocumentDraft !== doc.title;
    const allowInlineDocumentEdit = onDocumentRename && isSelected && totalSelectionCount === 1;

    const { openDocument } = useDocumentOpen();

    const handlers = {
        onClick: (event: React.MouseEvent) => {
            if (onEntryPointer) {
                onEntryPointer({ type: 'document', id: doc.id, key: createDocumentEntryKey(doc.id), document: doc }, event);
            } else {
                const key = createDocumentEntryKey(doc.id);
                handleEntrySelection(key, event);
            }
        },
        onDoubleClick: (event: React.MouseEvent) => {
            const isPreview = event && (event.altKey || event.button === 1);
            openDocument(doc, isPreview ? 'preview' : 'inspect');
        },
        onDragStart: (event: DragEvent<HTMLElement>) => onDocumentDragStart?.(event, doc),
        onDragEnd: (event: DragEvent<HTMLElement>) => onDocumentDragEnd?.(event),
        onDragOver: (event: DragEvent<HTMLElement>) => tagHandlers?.onTagDragOver(event, doc),
        onDragLeave: (event: DragEvent<HTMLElement>) => tagHandlers?.onTagDragLeave(event, doc.id),
        onDrop: (event: DragEvent<HTMLElement>) => { tagHandlers?.onTagDrop(event, doc); },
        tagHandlers,
        onRenameChange: setDocumentDraft,
        onRenameSubmit: () => submitDocumentEditing(doc),
        onRenameCancel: (event?: React.SyntheticEvent) => cancelDocumentEditing(event),
        onRenameBegin: (event: React.SyntheticEvent) => {
            if (!allowInlineDocumentEdit) return;
            event.preventDefault();
            event.stopPropagation();
            beginDocumentEditing(doc);
        },
    };

    const documentRenameProps: RenameState = {
        isEditing: isEditingDoc,
        draftValue: documentDraftValue,
        onChange: setDocumentDraft,
        onSubmit: () => submitDocumentEditing(doc),
        onCancel: (event?: React.SyntheticEvent) => cancelDocumentEditing(event),
        isSaving: isDocumentSaving,
        canSubmit: canSubmitDocument,
        inputRef: attachDocumentInputRef,
        allowInlineEdit: allowInlineDocumentEdit,
        onBeginEditing: (event: React.SyntheticEvent) => {
            if (!allowInlineDocumentEdit) return;
            event.preventDefault();
            event.stopPropagation();
            beginDocumentEditing(doc);
        },
    };

    return {
        isSelected,
        isDraggingDoc,
        isEditingDoc,
        documentDraftValue,
        isDocumentSaving,
        canSubmitDocument,
        allowInlineDocumentEdit,
        attachDocumentInputRef,
        documentRenameProps,
        handlers,
    };
};


