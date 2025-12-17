import { createContext, useContext, type RefObject } from 'react';
import type { Tag, Correspondent } from '../../types/documents';
import type { Identifier } from '../../types/identifiers';

interface DocumentsViewStateContextValue {
    viewId?: string | null;
    scrollRef?: RefObject<HTMLElement | null>;
    tagLookupById?: Map<Identifier, Tag> | null;
    correspondentLookupById?: Map<Identifier, Correspondent> | null;
    activeCorrespondentIdSet?: Set<Identifier> | null;
    draggingDocumentIdsSet?: Set<Identifier> | null;
    draggedFolderId?: Identifier | 'root' | null;
}

export const DocumentsViewStateContext = createContext<DocumentsViewStateContextValue>({});

export const useDocumentsViewStateContext = () => useContext(DocumentsViewStateContext);
