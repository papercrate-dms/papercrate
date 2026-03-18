// Types aligned with OpenAPI schemas for common endpoints.
import type { Identifier } from '../../types/identifiers';

export type { Identifier };

export interface DownloadLink {
  url: string;
  expires_at: number;
}

export interface TagResponse {
  id: string;
  label: string;
  color?: string | null;
}

export interface CorrespondentResponse {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
}

export interface AssetResponse {
  id: string;
  asset_type: string;
  mime_type: string;
  metadata: Record<string, unknown>;
  download?: DownloadLink | null;
  [key: string]: unknown;
}

interface DocumentVersionResponse {
  id: string;
  version_number: number;
  size_bytes: number;
  checksum: string;
  created_at: string;
  mime_type?: string | null;
  metadata: Record<string, unknown>;
  download: DownloadLink;
  assets?: AssetResponse[] | null;
}

export interface DocumentResponse {
  id: string;
  filename: string;
  title: string;
  original_name: string;
  mime_type?: string | null;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
  issued_at?: string | null;
  metadata: Record<string, unknown>;
  tags: TagResponse[];
  correspondents?: CorrespondentResponse[];
  current_version?: DocumentVersionResponse | null;
}

export interface FolderInfo {
  id: string;
  name: string;
  parent_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateFolderResponse {
  folder: FolderInfo;
}

export interface FolderTreeNode extends FolderInfo {
  children?: FolderTreeNode[];
  hasChildren?: boolean;
  loaded?: boolean;
}

export interface CapabilitySetResponse {
  id: string;
  slug: string;
  is_system: boolean;
  cap_version: number;
  capabilities: string[];
}

export interface CapabilityResponse {
  id?: string;
  name: string;
}

export interface TenantSnippet {
  id: string;
  name: string;
}

export interface ApiTokenRecord {
  id: string;
  label?: string | null;
  capability_set_id: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
}

export interface PasskeySummary {
  id: string;
  nickname?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  transports?: string[];
  revokedAt?: string | null;
  revokedReason?: string | null;
}

export interface TenantUserSummary {
  user_id: string;
  username: string;
  capability_set_id?: string | null;
  capability_set_slug?: string | null;
}
