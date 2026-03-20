import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DocumentId, FolderId, Identifier, TagId } from '../../types/identifiers';
import type { Document, Tag, Correspondent } from '../../types/documents';

import type TagManager from '../../lib/assets/TagManager';
import type CorrespondentManager from '../../lib/assets/CorrespondentManager';

interface DocumentsManagerInterface {
    map(mapper: (doc: Document) => Document | undefined): boolean;
    update(id: DocumentId, updater: (doc: Document) => Partial<Document> | Document | undefined): boolean;
    ingest(rawDocs: Document[]): { canonical: Document[]; changed: boolean };
    remove(ids: Array<DocumentId>): boolean;
    list(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<DocumentId[]>;
    updateFields(id: DocumentId, fields: Record<string, unknown>): Promise<Document | null>;
    trash(id: DocumentId): Promise<void>;
    restore(id: DocumentId, folderId?: Identifier | null): Promise<void>;
    purge(id: DocumentId): Promise<void>;
    reanalyze(id: DocumentId, options?: { force?: boolean }): Promise<void>;
    bulkReanalyze(ids: Identifier[]): Promise<{ queued?: number }>;
    addTags(documentId: DocumentId, tagIds: Identifier[]): Promise<void>;
    removeTag(documentId: DocumentId, tagId: Identifier): Promise<void>;
    bulkTag(documentIds: Identifier[], tagIds: Identifier[], action: 'add' | 'remove'): Promise<void>;
    addCorrespondent(documentId: DocumentId, correspondentId: Identifier): Promise<void>;
    removeCorrespondent(documentId: DocumentId, correspondentId: Identifier): Promise<void>;
    bulkCorrespondent(documentIds: Identifier[], assignments: Array<{ correspondent_id?: Identifier }>, action: 'add' | 'remove'): Promise<void>;
    moveToFolder(id: DocumentId, folderId: Identifier | null): Promise<void>;
    bulkMove(ids: Identifier[], folderId: Identifier | null): Promise<void>;
}

export interface DocumentsState {
    documentLookup: Map<DocumentId, Document>;
    setDocuments: Dispatch<SetStateAction<Document[]>>;
    documentsManager: DocumentsManagerInterface;
}

export interface FolderState {
    selectedFolder: FolderId;
    folderLabelMap: Map<FolderId, string>;
}

export interface SelectionState {
    setSelectedEntries: Dispatch<SetStateAction<string[]>>;
    setSelectionOrder: Dispatch<SetStateAction<string[]>>;
    selectionOrderRef: MutableRefObject<string[] | null>;
    selectionAnchorRef: MutableRefObject<string | null>;
    setFocusedDocumentId: Dispatch<SetStateAction<DocumentId | null>>;
    focusedDocumentId: DocumentId | null;
    setFocusedEntryKey: Dispatch<SetStateAction<string | null>>;
    focusedEntryKey: string | null;
}

export interface TagsState {
    tags: Tag[];
    tagLookupById: Map<TagId, Tag>;
    refreshTags: () => Promise<void>;
    tagManager: TagManager;
}

export interface CorrespondentsState {
    correspondents: Correspondent[];
    correspondentLookupById: Map<Identifier, Correspondent>;
    correspondentLookupByName?: Map<string, Correspondent>;
    refreshCorrespondents: () => Promise<void>;
    correspondentManager: CorrespondentManager;
}

export interface DragState {
    draggedDocumentIds: DocumentId[];
    draggedFolderId: FolderId | null;
    setDraggedDocumentIds: (ids: DocumentId[]) => void;
    setDraggedFolderId: (id: FolderId | null) => void;
}
