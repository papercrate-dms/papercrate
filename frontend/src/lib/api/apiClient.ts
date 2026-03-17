import api from './api';
export { api };
import type {
  ApiTokenRecord,
  AssetResponse,
  CapabilitySetResponse,
  DownloadLink,
  DocumentResponse,
  Identifier,
  PasskeySummary,
  TenantSnippet,
  TagResponse,
  CorrespondentResponse,
  FolderTreeNode,
  CreateFolderResponse,
} from './apiTypes';
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig, AxiosRequestConfig } from 'axios';

export const httpClient: Pick<AxiosInstance, 'get' | 'post' | 'patch' | 'delete' | 'defaults'> = {
  get: api.get.bind(api),
  post: api.post.bind(api),
  patch: api.patch.bind(api),
  delete: api.delete.bind(api),
  defaults: api.defaults,
};

type AuthAwareRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  skipAuthRefresh?: boolean;
};

type AuthRequestConfig = AxiosRequestConfig & {
  skipAuthRefresh?: boolean;
};
type AuthRefreshHandlers = {
  onRefreshSuccess?: (token: string, payload?: { tenant?: unknown }) => void;
  onRefreshFailure?: (error: unknown) => void;
};

let refreshPromise: Promise<string> | null = null;
let authRefreshHandlers: AuthRefreshHandlers = {};

const normalizeNumber = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeDownload = (input?: DownloadLink | null): DownloadLink | null => {
  if (!input?.url) {
    return null;
  }
  const expires_at = normalizeNumber(input.expires_at);
  if (!expires_at) {
    return null;
  }
  return { url: input.url, expires_at };
};

export const fetchDocument = async (id: Identifier): Promise<DocumentResponse> => {
  const { data } = await api.get<{ document?: DocumentResponse }>(`/documents/${id}`);
  const doc = data?.document || (data as DocumentResponse);
  if (doc?.current_version?.download) {
    doc.current_version.download = normalizeDownload(doc.current_version.download);
  }
  return doc;
};

export const fetchAsset = async (id: Identifier): Promise<AssetResponse> => {
  const { data } = await api.get<AssetResponse>(`/assets/${id}`);
  const download = normalizeDownload(data.download);
  return {
    ...data,
    download,
  };
};

export const listDocuments = async (params: Record<string, unknown> = {}): Promise<DocumentResponse[]> => {
  const { data } = await api.get<DocumentResponse[]>('/documents', { params });
  return Array.isArray(data) ? data : [];
};

export const getFolderTree = async (): Promise<FolderTreeNode[]> => {
  const { data } = await api.get<FolderTreeNode[]>('/folders/tree');
  return Array.isArray(data) ? data : [];
};

export const listCapabilitySets = async (): Promise<CapabilitySetResponse[]> => {
  const { data } = await api.get<CapabilitySetResponse[]>('/capability-sets');
  return Array.isArray(data) ? data : [];
};

export const listCapabilities = async (): Promise<string[]> => {
  const { data } = await api.get<string[]>('/capabilities');
  return Array.isArray(data) ? data : [];
};

export const listApiTokens = async (): Promise<ApiTokenRecord[]> => {
  const { data } = await api.get<ApiTokenRecord[]>('/profile/api-tokens');
  return Array.isArray(data) ? data : [];
};

export const listPasskeys = async (): Promise<PasskeySummary[]> => {
  const { data } = await api.get<PasskeySummary[]>('/profile/passkeys');
  return Array.isArray(data) ? data : [];
};

export const moveDocumentsBulk = async (documentIds: Identifier[], folderId: Identifier | null): Promise<void> => {
  await api.post('/documents/bulk/move', {
    document_ids: documentIds,
    folder_id: folderId,
  });
};

export const queueDocumentReanalysis = async (
  documentId: Identifier,
  options: { force?: boolean } = {},
): Promise<void> => {
  const { force = false } = options;
  await api.post(`/documents/${documentId}/assets`, null, { params: { force } });
};

export const trashDocument = async (documentId: Identifier): Promise<void> => {
  await api.post(`/documents/${documentId}/trash`);
};

export const restoreDocument = async (documentId: Identifier, folderId?: Identifier | null): Promise<void> => {
  await api.post(`/documents/${documentId}/restore`, { folder_id: folderId ?? null });
};

export const purgeDocument = async (documentId: Identifier): Promise<void> => {
  await api.delete(`/documents/${documentId}`);
};

export const addDocumentTags = async (documentId: Identifier, tagIds: Identifier[]): Promise<void> => {
  await api.post(`/documents/${documentId}/tags`, { tag_ids: tagIds });
};

export const createTag = async (payload: { label: string; color?: string | null }): Promise<TagResponse> => {
  const { data } = await api.post<TagResponse>('/tags', payload);
  return data;
};

export const createFolder = async (payload: { name: string; parent_id?: Identifier | null }): Promise<CreateFolderResponse> => {
  const { data } = await api.post<CreateFolderResponse>('/folders', payload);
  return data;
};

export const assignCorrespondentsBulk = async <T = unknown>(
  payload: Record<string, unknown>,
): Promise<T> => {
  const { data } = await api.post<T>('/documents/bulk/correspondents', payload);
  return data;
};

export const createApiToken = async (payload: {
  capability_set_id: Identifier;
  label?: string;
  expires_at?: string;
}): Promise<{ token_info?: ApiTokenRecord; token?: string }> => {
  const { data } = await api.post('/profile/api-tokens', payload);
  return data as { token_info?: ApiTokenRecord; token?: string };
};

export const regenerateApiToken = async (
  tokenId: Identifier,
): Promise<{ token_info?: ApiTokenRecord; token?: string }> => {
  const { data } = await api.post(`/profile/api-tokens/${tokenId}/regenerate`);
  return data as { token_info?: ApiTokenRecord; token?: string };
};

export const startPasskeyRegistration = async (): Promise<unknown> => {
  const { data } = await api.post('/auth/passkeys/register/start', {});
  return data;
};

export const finishPasskeyRegistration = async (payload: unknown): Promise<unknown> => {
  const { data } = await api.post('/auth/passkeys/register/finish', payload);
  return data;
};

export const startPasskeyLogin = async (username: string): Promise<unknown> => {
  const { data } = await api.post('/auth/passkeys/login/start', { username });
  return data;
};

export const finishPasskeyLogin = async (payload: unknown): Promise<unknown> => {
  const { data } = await api.post('/auth/passkeys/login/finish', payload);
  return data;
};

export const performLogin = async (payload: Record<string, unknown>): Promise<unknown> => {
  const { data } = await api.post('/auth/login', payload);
  return data;
};

export const refreshSession = async (): Promise<{ access_token?: string; tenant?: unknown }> => {
  const { data } = await api.post('/auth/refresh', undefined, { skipAuthRefresh: true } as AuthRequestConfig);
  return data as { access_token?: string; tenant?: unknown };
};

export const logoutSession = async (): Promise<void> => {
  await api.post('/auth/logout');
};

export const selectTenant = async (
  payload: { tenant_id: Identifier },
  selectionToken: string,
): Promise<unknown> => {
  const { data } = await api.post('/auth/select-tenant', payload, {
    headers: {
      Authorization: `Bearer ${selectionToken}`,
    },
  });
  return data;
};

export const startSignup = async (username: string): Promise<unknown> => {
  const { data } = await api.post('/auth/signup/start', { username });
  return data;
};

export const finishSignup = async (payload: unknown): Promise<unknown> => {
  const { data } = await api.post('/auth/signup/finish', payload);
  return data;
};

export const updateDocument = async (
  id: Identifier,
  payload: Record<string, unknown>,
): Promise<DocumentResponse> => {
  const { data } = await api.patch<DocumentResponse>(`/documents/${id}`, payload);
  return data;
};

export const moveDocumentToFolder = async (id: Identifier, folderId: Identifier | null): Promise<void> => {
  await api.patch(`/documents/${id}/folder`, { folder_id: folderId });
};

export const deleteDocumentTag = async (documentId: Identifier, tagId: Identifier): Promise<void> => {
  await api.delete(`/documents/${documentId}/tags/${tagId}`);
};

export const deleteFolder = async (folderId: Identifier): Promise<void> => {
  await api.delete(`/folders/${folderId}`);
};

export const moveFolder = async (folderId: Identifier, parentId: Identifier | null): Promise<void> => {
  await api.patch(`/folders/${folderId}`, { parent_id: parentId });
};

export const renameFolder = async (folderId: Identifier, name: string): Promise<void> => {
  await api.patch(`/folders/${folderId}`, { name });
};

export const createCapabilitySet = async (
  payload: { slug?: string; label?: string; capabilities: string[] },
): Promise<CapabilitySetResponse & { label?: string }> => {
  const { data } = await api.post<CapabilitySetResponse & { label?: string }>('/capability-sets', payload);
  return data;
};

export const updateCapabilitySet = async (
  id: Identifier,
  payload: { slug?: string; label?: string; capabilities?: string[] },
): Promise<CapabilitySetResponse & { label?: string }> => {
  const { data } = await api.patch<CapabilitySetResponse & { label?: string }>(`/capability-sets/${id}`, payload);
  return data;
};

export const deleteCapabilitySet = async (id: Identifier): Promise<void> => {
  await api.delete(`/capability-sets/${id}`);
};

export const deleteApiToken = async (tokenId: Identifier): Promise<void> => {
  await api.delete(`/profile/api-tokens/${tokenId}`);
};

export const deletePasskey = async (
  passkeyId: Identifier,
  options: { reason?: string } = {},
): Promise<void> => {
  const query = options.reason ? `?reason=${encodeURIComponent(options.reason)}` : '';
  await api.delete(`/profile/passkeys/${passkeyId}${query}`);
};

export const listTenants = async (): Promise<TenantSnippet[]> => {
  const { data } = await api.get<{ tenants?: TenantSnippet[] } | TenantSnippet[]>('/tenants');
  if (Array.isArray(data)) {
    return data;
  }
  return Array.isArray(data?.tenants) ? data.tenants : [];
};

export const setAuthToken = (token: string) => {
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
};

export const clearAuthToken = () => {
  delete api.defaults.headers.common.Authorization;
};

export const setAuthRefreshHandlers = (handlers: AuthRefreshHandlers) => {
  authRefreshHandlers = handlers;
};

const performTokenRefresh = async (): Promise<string> => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshSession()
    .then((data) => {
      const token = data?.access_token;
      if (!token) {
        throw new Error('Missing access token in refresh response');
      }
      setAuthToken(token);
      authRefreshHandlers.onRefreshSuccess?.(token, { tenant: data?.tenant });
      return token;
    })
    .catch((error) => {
      authRefreshHandlers.onRefreshFailure?.(error);
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const response = error.response;
    const config = (error.config || {}) as AuthAwareRequestConfig;
    if (!response || response.status !== 401 || config._retry || config.skipAuthRefresh) {
      return Promise.reject(error);
    }

    config._retry = true;

    try {
      const token = await performTokenRefresh();
      const headers = (config.headers ?? {}) as Record<string, unknown>;
      headers.Authorization = `Bearer ${token}`;
      config.headers = headers as AuthAwareRequestConfig['headers'];
      return api(config);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

export const uploadDocument = async (
  formData: FormData,
): Promise<{ reused?: boolean; document?: unknown; status?: number }> => {
  const { data, status } = await api.post<{ reused?: boolean; document?: unknown }>('/documents', formData);
  return { ...data, status };
};

export const resolveFolderPath = async (
  payload: { parent_id?: Identifier | null; segments: string[] },
): Promise<{ folder?: { id?: Identifier | null } }> => {
  const { data } = await api.post<{ folder?: { id?: Identifier | null } }>('/folders/path', payload);
  return data;
};

export const bulkTagDocuments = async (
  payload: { document_ids: Identifier[]; tag_ids: Identifier[]; action: 'add' | 'remove' },
): Promise<void> => {
  await api.post('/documents/bulk/tags', payload);
};

export const bulkReanalyzeDocuments = async (
  payload: { document_ids: Identifier[]; force?: boolean },
): Promise<{ queued?: number }> => {
  const { data } = await api.post<{ queued?: number }>('/documents/bulk/reanalyze', payload);
  return data;
};

export const listTags = async (): Promise<TagResponse[]> => {
  const { data } = await api.get<TagResponse[]>('/tags');
  return Array.isArray(data) ? data : [];
};

export const updateTag = async (
  tagId: Identifier,
  payload: { label?: string; color?: string | null },
): Promise<void> => {
  await api.patch(`/tags/${tagId}`, payload);
};

export const deleteTag = async (tagId: Identifier): Promise<void> => {
  await api.delete(`/tags/${tagId}`);
};

export const listCorrespondents = async (): Promise<CorrespondentResponse[]> => {
  const { data } = await api.get<CorrespondentResponse[]>('/correspondents');
  return Array.isArray(data) ? data : [];
};

export const createCorrespondent = async (payload: { name: string }): Promise<CorrespondentResponse> => {
  const { data } = await api.post<CorrespondentResponse>('/correspondents', payload);
  return data;
};

export const updateCorrespondent = async (
  correspondentId: Identifier,
  payload: { name?: string },
): Promise<void> => {
  await api.patch(`/correspondents/${correspondentId}`, payload);
};

export const deleteCorrespondent = async (correspondentId: Identifier): Promise<void> => {
  await api.delete(`/correspondents/${correspondentId}`);
};

export const addDocumentCorrespondent = async (
  documentId: Identifier,
  correspondentId: Identifier,
): Promise<void> => {
  await api.post(`/documents/${documentId}/correspondents`, {
    assignments: [{ correspondent_id: correspondentId }],
    replace: false,
  });
};

export const removeDocumentCorrespondent = async (
  documentId: Identifier,
  correspondentId: Identifier,
): Promise<void> => {
  await api.delete(`/documents/${documentId}/correspondents/${correspondentId}`);
};



export const switchTenant = async (tenantId: Identifier): Promise<{ access_token: string; tenant: any; tenants?: any[] }> => {
  const { data } = await api.post<{ access_token: string; tenant: any; tenants?: any[] }>('/auth/select-tenant', {
    tenant_id: tenantId,
  });
  return data;
};

export const listFolderContents = async <T = any>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  if (path === 'trash') {
    const docs = await listDocuments({ status: 'deleted', ...params });
    return { documents: docs, subfolders: [] } as T;
  }
  const { data } = await api.get<T>(`/folders/${path}/contents`, { params });
  return data;
};

export type { ApiTokenRecord } from './apiTypes';
