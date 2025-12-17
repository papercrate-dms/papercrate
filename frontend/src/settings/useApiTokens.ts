import { useCallback, useState } from 'react';
import {
  createApiToken,
  deleteApiToken,
  listApiTokens,
  regenerateApiToken,
  type ApiTokenRecord,
} from '../lib/api/apiClient';
import type { ApiTokenId, CapabilitySetId } from '../types/identifiers';

interface ApiTokensResponse {
  token_info?: ApiTokenRecord;
  token?: string;
}

interface CreateTokenArgs {
  label?: string;
  expires_at?: string;
  capability_set_id?: CapabilitySetId;
}

interface UseApiTokensArgs {
  notifyApiError?: (error: unknown, message: string) => void;
  setStatusMessage?: (message: string, variant?: string) => void;
  token?: string | null;
}

interface UseApiTokensResult {
  tokens: ApiTokenRecord[];
  loading: boolean;
  creating: boolean;
  deletingId: ApiTokenId | null;
  regeneratingId: ApiTokenId | null;
  createdSecret: string | null;
  refresh: () => Promise<void>;
  create: (args?: CreateTokenArgs) => Promise<ApiTokensResponse | false>;
  revoke: (tokenId?: ApiTokenId | null) => Promise<boolean>;
  regenerate: (tokenId?: ApiTokenId | null) => Promise<boolean>;
  dismissSecret: () => void;
}

const useApiTokens = ({ notifyApiError, setStatusMessage, token }: UseApiTokensArgs): UseApiTokensResult => {
  const [tokens, setTokens] = useState<ApiTokenRecord[]>([]);
  const [loading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<ApiTokenId | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<ApiTokenId | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const data = await listApiTokens();
      setTokens(Array.isArray(data) ? data : []);
    } catch (error) {
      notifyApiError?.(error, 'Failed to load API tokens.');
    }
  }, [notifyApiError, token]);

  const create = useCallback(
    async ({ label, expires_at, capability_set_id }: CreateTokenArgs = {}) => {
      if (creating || !capability_set_id) {
        return false;
      }
      setCreating(true);
      try {
        const payload: { capability_set_id: CapabilitySetId; label?: string; expires_at?: string } = { capability_set_id };
        if (label) {
          payload.label = label;
        }
        if (expires_at) {
          payload.expires_at = expires_at;
        }

        const data = await createApiToken(payload) as ApiTokensResponse;
        if (data?.token_info) {
          setTokens((previous) => {
            const filtered = previous.filter((entry) => entry.id !== data.token_info?.id);
            return data.token_info ? [data.token_info, ...filtered] : filtered;
          });
        } else {
          await refresh();
        }

        if (data?.token) {
          setCreatedSecret(data.token);
        }

        setStatusMessage?.('API token created.', 'success');
        return data;
      } catch (error) {
        notifyApiError?.(error, 'Failed to create API token.');
        return false;
      } finally {
        setCreating(false);
      }
    },
    [creating, notifyApiError, refresh, setStatusMessage],
  );

  const revoke = useCallback(
    async (tokenId?: string | null) => {
      if (!tokenId) {
        return false;
      }
      setDeletingId(tokenId);
      try {
        await deleteApiToken(tokenId);
        await refresh();
        setStatusMessage?.('API token revoked.', 'success');
        return true;
      } catch (error) {
        notifyApiError?.(error, 'Failed to revoke API token.');
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [notifyApiError, refresh, setStatusMessage],
  );

  const regenerate = useCallback(
    async (tokenId?: string | null) => {
      if (!tokenId) {
        return false;
      }
      setRegeneratingId(tokenId);
      try {
        const data = await regenerateApiToken(tokenId) as ApiTokensResponse;
        if (data?.token_info) {
          setTokens((previous) => {
            let found = false;
            const next = previous.map((entry) => {
              if (entry.id === data.token_info?.id) {
                found = true;
                return data.token_info;
              }
              return entry;
            });
            if (!found && data.token_info) {
              return [data.token_info, ...previous];
            }
            return next;
          });
        } else {
          await refresh();
        }

        if (data?.token) {
          setCreatedSecret(data.token);
        }

        setStatusMessage?.('API token regenerated.', 'success');
        return true;
      } catch (error) {
        notifyApiError?.(error, 'Failed to regenerate API token.');
        return false;
      } finally {
        setRegeneratingId(null);
      }
    },
    [notifyApiError, refresh, setStatusMessage],
  );

  const dismissSecret = useCallback(() => {
    setCreatedSecret(null);
  }, []);

  return {
    tokens,
    loading,
    creating,
    deletingId,
    regeneratingId,
    createdSecret,
    refresh,
    create,
    revoke,
    regenerate,
    dismissSecret,
  };
};

export default useApiTokens;
