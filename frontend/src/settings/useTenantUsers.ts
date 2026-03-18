import { useCallback, useEffect, useState } from 'react';
import {
  listTenantUsers,
  updateTenantUser as updateTenantUserRequest,
  deleteTenantUser as deleteTenantUserRequest,
} from '../lib/api/apiClient';
import type { Identifier } from '../types/identifiers';
import type { TenantUserSummary } from '../lib/api/apiTypes';

interface UseTenantUsersOptions {
  notifyApiError?: (error: unknown, message: string) => void;
  setStatusMessage?: (message: string, level?: string) => void;
  token?: string | null;
  tenantId?: Identifier | null;
}

const useTenantUsers = ({ notifyApiError, setStatusMessage, token, tenantId }: UseTenantUsersOptions) => {
  const [tenantUsers, setTenantUsers] = useState<TenantUserSummary[]>([]);
  const [tenantUsersLoading, setTenantUsersLoading] = useState(false);
  const [savingTenantUserId, setSavingTenantUserId] = useState<Identifier | null>(null);
  const [deletingTenantUserId, setDeletingTenantUserId] = useState<Identifier | null>(null);

  const refreshTenantUsers = useCallback(async () => {
    if (!token || !tenantId) {
      setTenantUsers([]);
      return;
    }
    setTenantUsersLoading(true);
    try {
      const data = await listTenantUsers(tenantId);
      setTenantUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      notifyApiError?.(error, 'Failed to load members.');
    } finally {
      setTenantUsersLoading(false);
    }
  }, [notifyApiError, token, tenantId]);

  useEffect(() => {
    if (token && tenantId) {
      refreshTenantUsers();
    } else {
      setTenantUsers([]);
    }
  }, [refreshTenantUsers, token, tenantId]);

  const updateTenantUser = useCallback(
    async (userId: Identifier | null, capabilitySetId: Identifier) => {
      if (!userId || !tenantId) {
        return false;
      }
      setSavingTenantUserId(userId);
      try {
        const data = await updateTenantUserRequest(tenantId, userId, {
          capability_set_id: capabilitySetId,
        });
        if (data) {
          setTenantUsers((previous) =>
            previous.map((entry) =>
              entry.user_id === data.user_id ? data : entry,
            ),
          );
        } else {
          await refreshTenantUsers();
        }
        setStatusMessage?.('Member updated.', 'success');
        return true;
      } catch (error) {
        notifyApiError?.(error, 'Failed to update member.');
        return false;
      } finally {
        setSavingTenantUserId(null);
      }
    },
    [notifyApiError, refreshTenantUsers, setStatusMessage, tenantId],
  );

  const deleteTenantUser = useCallback(
    async (userId: Identifier | null) => {
      if (!userId || !tenantId) {
        return false;
      }
      setDeletingTenantUserId(userId);
      try {
        await deleteTenantUserRequest(tenantId, userId);
        setTenantUsers((previous) => previous.filter((entry) => entry.user_id !== userId));
        setStatusMessage?.('Member removed.', 'success');
        return true;
      } catch (error) {
        notifyApiError?.(error, 'Failed to remove member.');
        return false;
      } finally {
        setDeletingTenantUserId(null);
      }
    },
    [notifyApiError, setStatusMessage, tenantId],
  );

  return {
    tenantUsers,
    tenantUsersLoading,
    savingTenantUserId,
    deletingTenantUserId,
    refreshTenantUsers,
    updateTenantUser,
    deleteTenantUser,
  };
};

export default useTenantUsers;
