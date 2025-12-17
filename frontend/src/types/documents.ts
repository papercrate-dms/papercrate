import type { Identifier } from './identifiers';
import type { Asset } from './assets';
import type { Download } from './common';

export interface Tag {
    id: Identifier;
    label: string;
    color: string | null;
    usage_count: number;
}

export interface Correspondent {
    id: Identifier;
    name: string;
    usage_count: number;
}

export interface DocumentVersion {
    assets?: Record<string, Asset> | Asset[] | null;
    metadata?: Record<string, unknown> & { page_count?: number } | null;
    size_bytes?: number | null;
    checksum?: string | null;
    download?: Download | null;
}

export interface MessageOptions {
    showMessage?: boolean;
}

export interface Document {
    id?: Identifier;
    title?: string | null;
    original_name?: string | null;
    filename?: string | null;
    mime_type?: string | null;

    issued_at?: string | number | null;
    created_at?: string | null;
    uploaded_at?: string | null;
    updated_at?: string | null;

    folder_id?: Identifier | null;
    folder_name?: string;
    folder_path?: string;

    tags?: Identifier[] | null;
    correspondents?: Identifier[] | null;

    current_version?: DocumentVersion | null;

    // Allow for other properties as we unify loosely typed interfaces
    [key: string]: unknown;
}

export interface Folder {
    id: Identifier | 'root';
    name: string;
    parent_id?: Identifier | 'root' | null;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
}

type FolderEntry = {
    type: 'folder';
    id: Identifier | 'root';
    key: string;
    folder: Folder;
};

type DocumentEntry = {
    type: 'document';
    id: Identifier;
    key: string;
    document: Document;
};

export type DocumentsListEntry = FolderEntry | DocumentEntry;

/**
 * Represents a folder node in the UI tree structure (flat map representation).
 */
export interface FolderNode {
    id: Identifier | 'root';
    name?: string;
    parentId?: Identifier | 'root' | null;
    children: (Identifier | 'root')[];
    expanded?: boolean;
    loaded?: boolean;
    hasChildren?: boolean;
    [key: string]: unknown;
}
