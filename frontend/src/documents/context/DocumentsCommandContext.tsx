import React, { createContext, useContext, type DragEvent } from 'react';
import type { Document } from '../../types/documents';
import type { Identifier } from '../../types/identifiers';

interface DocumentsCommandContextValue {
    folder: {
        onClick?: (folder: any, event: React.MouseEvent) => void;
        onSelect?: (folderId: Identifier | 'root') => void;
        onRename?: (folderId: Identifier | 'root', nextName: string) => Promise<boolean> | boolean;
        onDrag: {
            start?: (event: DragEvent<HTMLElement>, folderId: Identifier | 'root') => void;
            end?: (event: DragEvent<HTMLElement>) => void;
            over?: (event: DragEvent<HTMLElement>, folderId: Identifier | 'root') => void;
            leave?: (event: DragEvent<HTMLElement>) => void;
            drop?: (event: DragEvent<HTMLElement>, folderId: Identifier | 'root') => void;
        };
    };
    document: {
        onRename?: (documentId: Identifier, nextTitle: string) => Promise<boolean> | boolean;
        onDrag: {
            start?: (event: DragEvent<HTMLElement>, document: Document) => void;
            end?: (event: DragEvent<HTMLElement>) => void;
        };
    };
    correspondents: {
        onClick?: (correspondentId: Identifier) => void;
    };
    // General entry pointer for selection/etc
    onEntryPointer?: (entry: any, event: any) => void;
}

export const DocumentsCommandContext = createContext<DocumentsCommandContextValue>({
    folder: { onDrag: {} },
    document: { onDrag: {} },
    correspondents: {},
});

export const useDocumentsCommandContext = () => useContext(DocumentsCommandContext);
