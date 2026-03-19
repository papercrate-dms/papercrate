import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import type { TenantId } from '../../types/identifiers';
import { useStatusToast } from '../../lib/context/StatusToastContext';
import { useAppDispatch } from '../../lib/store/appState';

import { setAuthToken, listTenants, switchTenant } from '../../lib/api/apiClient';

import useNotifyApiError from '../../hooks/useNotifyApiError';

interface TenantOption {
  id?: TenantId;
  name?: string;
}

interface UseTenantManagerOptions {
  currentTenantId: TenantId | null;
  handleDocumentsViewModeChange: (mode: string) => void;
}

const useTenantManager = ({
  currentTenantId,
  handleDocumentsViewModeChange,
}: UseTenantManagerOptions) => {
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();
  const navigate = useNavigate();
  const appDispatch = useAppDispatch();

  const handleTenantSelect = useCallback(
    async (tenantOption: TenantOption | null, { refreshOnly = false }: { refreshOnly?: boolean } = {}) => {
      const requestedTenantId = tenantOption?.id ?? null;

      // 1. Guard Clauses
      if (!refreshOnly && (!requestedTenantId || requestedTenantId === currentTenantId)) {
        return;
      }

      try {
        // 2. Refresh Logic
        if (refreshOnly) {
          const data = await listTenants();
          appDispatch({ type: 'SET_TENANTS', tenants: data });
          return;
        }

        // 3. Switch Logic
        const data = await switchTenant(requestedTenantId);

        if (!data?.access_token) {
          throw new Error('Missing access token in tenant switch response.');
        }

        // 4. Reset UI to safe state BEFORE updating global auth
        // This prevents old components from reacting to state changes.


        // 5. Update Global State IMMEDIATELY
        // Don't wait for navigation. Data consistency comes first.
        handleDocumentsViewModeChange('list');
        setAuthToken(data.access_token);

        appDispatch({
          type: 'LOGIN_SUCCESS',
          token: data.access_token,
          tenant: data.tenant || null,
        });

        if (Array.isArray(data?.tenants)) {
          appDispatch({ type: 'SET_TENANTS', tenants: data.tenants });
        }

        const tenantLabel = data?.tenant?.name || data?.tenant?.id || 'tenant';
        showToast(`Switched to ${tenantLabel}.`, 'info');

        // 5. Handle UI/Navigation changes AFTER state is secure
        navigate('/folders', { replace: true });

      } catch (error) {
        notifyApiError(error, 'Failed to switch tenant.');
      }
    },
    [
      appDispatch,
      currentTenantId,
      handleDocumentsViewModeChange,
      navigate,
      notifyApiError,
      showToast,
    ],
  );

  return { handleTenantSelect };
};

export default useTenantManager;
