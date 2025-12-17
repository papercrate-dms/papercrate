import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { clearAuthToken, logoutSession, refreshSession, setAuthToken } from '../../lib/api/apiClient';
import { useStatusToast } from '../../lib/context/StatusToastContext';

import { useAppDispatch, useAppState } from '../../lib/store/appState';

interface UseAuthManagerArgs { }

interface UseAuthManagerResult {
  tokenRef: MutableRefObject<string | null>;
  refreshAccessToken: () => Promise<string>;
  handleLogout: () => Promise<void>;
}

const useAuthManager = (_: UseAuthManagerArgs = {}): UseAuthManagerResult => {
  const { token, status: appStatus } = useAppState();
  const appDispatch = useAppDispatch();
  const tokenRef = useRef<string | null>(token);
  const initialRefreshAttemptedRef = useRef(Boolean(token));
  const { showToast } = useStatusToast();

  const refreshAccessToken = useCallback(async (): Promise<string> => {
    console.log('[Auth] Attempting to refresh access token…');
    appDispatch({ type: 'TOKEN_REFRESH_START' });
    try {
      const data = await refreshSession();
      if (data?.access_token) {
        setAuthToken(data.access_token);
        appDispatch({
          type: 'TOKEN_REFRESH_SUCCESS',
          token: data.access_token,
          tenant: data.tenant || null,
        });
        console.log('[Auth] Access token refreshed at', new Date().toISOString());
        return data.access_token;
      }
      throw new Error('Missing access token in refresh response');
    } catch (error) {
      console.warn('[Auth] Failed to refresh access token', error);
      appDispatch({ type: 'TOKEN_REFRESH_FAILURE', error: (error as Error)?.message || null });
      throw error;
    }
  }, [appDispatch]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!token && !initialRefreshAttemptedRef.current && appStatus === 'logged-out') {
      initialRefreshAttemptedRef.current = true;
      console.log('[Auth] Attempting refresh at startup');
      refreshAccessToken().catch(() => { });
    }
  }, [token, appStatus, refreshAccessToken]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutSession();
    } catch (error) {
      console.warn('[Auth] Failed to revoke refresh token during logout', error);
    } finally {
      clearAuthToken();
      appDispatch({ type: 'LOGOUT' });
      showToast('Logged out.', 'info');
    }
  }, [appDispatch, showToast]);

  return { tokenRef, refreshAccessToken, handleLogout };
};

export default useAuthManager;
