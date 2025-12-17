import type { DocumentId, FolderId } from '../types/identifiers';
import { ENTRY_KEY_SEPARATOR } from '../constants/app';

// Entry key utilities for workspace selection
// Entry keys are strings in the format "document:id" or "folder:id"

// Create entry key strings
export const createDocumentEntryKey = (documentId: DocumentId): string =>
    `document${ENTRY_KEY_SEPARATOR}${documentId}`;

export const createFolderEntryKey = (folderId: FolderId): string =>
    `folder${ENTRY_KEY_SEPARATOR}${folderId}`;

// Type guards for entry key strings
export const isDocumentEntry = (key: string): boolean =>
    key.split(ENTRY_KEY_SEPARATOR, 1)[0] === 'document';

export const isFolderEntry = (key: string): boolean =>
    key.split(ENTRY_KEY_SEPARATOR, 1)[0] === 'folder';

// Extract ID from entry key string
export const getEntryId = (key: string): string => {
    const parts = key.split(ENTRY_KEY_SEPARATOR);
    return parts.slice(1).join(ENTRY_KEY_SEPARATOR);
};
