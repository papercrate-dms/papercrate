import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DocumentId, FolderId, Identifier } from '../../types/identifiers';
import type { Document, Tag, Correspondent } from '../../types/documents';

import type TagManager from '../../lib/assets/TagManager';
import type CorrespondentManager from '../../lib/assets/CorrespondentManager';

interface DocumentsManagerInterface {
    map(mapper: (doc: Document) => Document | undefined): boolean;
    update(id: DocumentId, updater: (doc: Document) => Partial<Document> | Document | undefined): boolean;
    ingest(rawDocs: unknown[]): { canonical: Document[]; changed: boolean };
    remove(ids: Array<DocumentId>): boolean;
}

export interface DocumentsState {
    documentLookup: Map<DocumentId, Document>;
    setDocuments: Dispatch<SetStateAction<Document[]>>;
    documentsManager: DocumentsManagerInterface;
    extractDocumentFromResponse?: (payload: unknown) => Document | null;
    ingestDocuments?: (docs: unknown[]) => { canonical: Document[]; changed: boolean };
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
    tagLookupById: Map<DocumentId, Tag>;
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
