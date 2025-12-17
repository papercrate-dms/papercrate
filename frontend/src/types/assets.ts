import type { Identifier } from './identifiers';
import type { Download } from './common';

export interface ThumbnailMetadata {
    width: number;
    height: number;
}

export interface Asset {
    id?: Identifier;
    asset_type?: string;
    download?: Download | null;
    metadata?: ThumbnailMetadata | Record<string, unknown> | null;
    [key: string]: unknown;
}
