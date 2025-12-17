/* global PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoginView from '../login/LoginView';
import useApiError from '../hooks/useApiError';
import {
  isWebAuthnAvailable,
  preparePublicKeyRequestOptions,
  preparePublicKeyCreationOptions,
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
} from '../utils/webauthn';
import { useAppDispatch, useAppState } from '../lib/store/appState';
import {
  finishPasskeyLogin,
  finishSignup,
  performLogin,
  selectTenant,
  startPasskeyLogin,
  startSignup,
} from '../lib/api/apiClient';

type StatusVariant = 'info' | 'success' | 'error';

interface StatusMessage {
  message: string;
  variant: StatusVariant;
}

interface TenantOption {
  id?: string | null;
  name?: string | null;
}

interface TenantSelectionState {
  selectionToken?: string | null;
  tenants?: TenantOption[];
}

type AuthResponse = {
  access_token?: string;
  tenant?: TenantOption | null;
  tenants?: TenantOption[];
};

const LoginRoute: React.FC = () => {
  const appState = useAppState();
  const { status: appStatus } = appState;
  const tenantSelection = (appState.tenantSelection ?? null) as TenantSelectionState | null;
  const appDispatch = useAppDispatch();
  const location = useLocation();
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [selectingTenantId, setSelectingTenantId] = useState(null);
  const passkeySupported = isWebAuthnAvailable();
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const signupSupported = passkeySupported;
  const [signupLoading, setSignupLoading] = useState(false);
  const [magicLoginPending, setMagicLoginPending] = useState(false);
  const magicLoginParams = useMemo(() => {
    const extract = (searchString) => {
      const params = new URLSearchParams(searchString || '');
      const token = (params.get('magic_token') || '').trim();
      const usernameHint = (params.get('username') || '').trim();
      const preferredTenantId = (params.get('preferred_tenant_id') || '').trim();
      return {
        token: token || null,
        username: usernameHint || null,
        preferredTenantId: preferredTenantId || null,
      };
    };

    let combined = extract(location.search);

    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');
    if (queryIndex !== -1) {
      const hashQuery = hash.slice(queryIndex + 1);
      const hashParams = extract(`?${hashQuery}`);
      combined = {
        token: combined.token || hashParams.token,
        username: combined.username || hashParams.username,
        preferredTenantId: combined.preferredTenantId || hashParams.preferredTenantId,
      };
    }
    if (!combined.token) {
      const searchParams = extract(window.location.search);
      combined = {
        token: combined.token || searchParams.token,
        username: combined.username || searchParams.username,
        preferredTenantId: combined.preferredTenantId || searchParams.preferredTenantId,
      };
    }

    return combined;
  }, [location.search]);
  const preferredTenantRef = useRef(null);
  const attemptedMagicTokenRef = useRef(null);
  const magicLoginPendingRef = useRef(false);
  const appStatusRef = useRef(appStatus);

  const {
    token: magicToken,
    username: magicUsername,
    preferredTenantId: magicPreferredTenantId,
  } = magicLoginParams;

  useEffect(() => {
    appStatusRef.current = appStatus;
  }, [appStatus]);

  const setStatusMessage = useCallback((message, variant = 'info') => {
    setStatus(message ? { message, variant } : null);
  }, []);

  const handleLoginApiReport = useCallback(
    ({ message, variant }) => setStatusMessage(message, variant),
    [setStatusMessage],
  );

  const reportLoginError = useApiError({
    onReport: handleLoginApiReport,
  });

  const notifyLoginError = useCallback(
    (error, fallbackMessage, variant = 'error') =>
      reportLoginError(error, { message: fallbackMessage, variant }),
    [reportLoginError],
  );

  const clearMagicParamsFromUrl = useCallback(() => {
    const removableKeys = ['magic_token', 'username', 'preferred_tenant_id'];
    const currentSearch = new URLSearchParams(window.location.search);
    let searchChanged = false;
    removableKeys.forEach((key) => {
      if (currentSearch.has(key)) {
        currentSearch.delete(key);
        searchChanged = true;
      }
    });

    const hash = window.location.hash || '';
    let nextHash = hash;
    const hashQuestionIndex = hash.indexOf('?');
    if (hashQuestionIndex !== -1) {
      const hashPath = hash.slice(0, hashQuestionIndex);
      const hashQuery = hash.slice(hashQuestionIndex + 1);
      const hashParams = new URLSearchParams(hashQuery);
      let hashChanged = false;
      removableKeys.forEach((key) => {
        if (hashParams.has(key)) {
          hashParams.delete(key);
          hashChanged = true;
        }
      });
      if (hashChanged) {
        const nextQuery = hashParams.toString();
        nextHash = nextQuery ? `${hashPath}?${nextQuery}` : hashPath;
      }
    }

    if (!searchChanged && nextHash === hash) {
      return;
    }

    const nextSearch = currentSearch.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`;
    window.history.replaceState(window.history.state, document.title, nextUrl);
  }, []);

  const handleTenantSelect = useCallback(
    async (tenant) => {
      if (!tenantSelection?.selectionToken || !tenant?.id) {
        return;
      }

      try {
        setSelectingTenantId(tenant.id);
        const data = await selectTenant(
          { tenant_id: tenant.id },
          tenantSelection.selectionToken,
        ) as AuthResponse;

        const accessToken = data?.access_token;
        if (!accessToken) {
          throw new Error('Invalid tenant selection response.');
        }

        appDispatch({
          type: 'LOGIN_SUCCESS',
          token: accessToken,
          tenant: data.tenant || null,
        });
        setStatusMessage('Login successful.', 'success');
      } catch (error) {
        const message = error?.response?.data?.error || 'Failed to finalize login.';
        notifyLoginError(error, message, 'error');
      } finally {
        setSelectingTenantId(null);
      }
    },
    [appDispatch, notifyLoginError, setStatusMessage, tenantSelection],
  );

  const handleCancelSelection = useCallback(() => {
    appDispatch({ type: 'CLEAR_TENANT_SELECTION' });
    setStatusMessage(null);
  }, [appDispatch, setStatusMessage]);

  const handlePasskeyLogin = useCallback(
    async (rawUsername) => {
      const username = rawUsername?.trim?.() || '';
      if (!username) {
        setStatusMessage('Enter your username before using a passkey.', 'error');
        return;
      }
      if (!passkeySupported) {
        setStatusMessage('Passkeys are not supported in this browser.', 'error');
        return;
      }

      setPasskeyLoading(true);
      appDispatch({ type: 'LOGIN_REQUEST' });
      try {
        const startData = await startPasskeyLogin(username);
        const challengeId = (startData as { challengeId?: string })?.challengeId;
        const publicKeyOptions = (startData as { publicKey?: PublicKeyCredentialRequestOptions })?.publicKey;

        if (!challengeId || !publicKeyOptions) {
          throw new Error('Invalid passkey challenge response.');
        }

        const publicKey = preparePublicKeyRequestOptions({ publicKey: publicKeyOptions });
        setStatusMessage('Confirm the passkey prompt to continue.', 'info');
        const assertion = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;

        if (!assertion) {
          setStatusMessage('Passkey login cancelled.', 'info');
          return;
        }

        if (!(assertion instanceof PublicKeyCredential)) {
          setStatusMessage('Unexpected credential response.', 'error');
          return;
        }

        const serialized = serializeAuthenticationCredential(assertion);
        const finishPayload = {
          challengeId,
          credential: serialized,
        };

        const finishData = await finishPasskeyLogin(finishPayload) as AuthResponse;

        if (finishData?.access_token && Array.isArray(finishData.tenants)) {
          appDispatch({
            type: 'TENANT_SELECTION_REQUIRED',
            selectionToken: finishData.access_token,
            tenants: finishData.tenants || [],
          });
          setStatusMessage('Select a tenant to continue.', 'info');
          return;
        }

        if (!finishData?.access_token) {
          throw new Error('Invalid login response.');
        }

        appDispatch({
          type: 'LOGIN_SUCCESS',
          token: finishData.access_token,
          tenant: finishData.tenant || null,
        });
        setStatusMessage('Login successful.', 'success');
      } catch (error) {
        if (error?.name === 'NotAllowedError') {
          setStatusMessage('Passkey login cancelled.', 'info');
        } else if (error?.response?.status === 404) {
          setStatusMessage('No passkey registered for this username. Create an account first.', 'error');
          appDispatch({ type: 'LOGIN_FAILURE', error: 'passkey not registered' });
        } else if (error?.response?.status === 400 && error?.response?.data?.error) {
          setStatusMessage(error.response.data.error, 'error');
          appDispatch({ type: 'LOGIN_FAILURE', error: error.response.data.error });
        } else {
          const message = error?.response?.data?.error || error.message || 'Passkey login failed.';
          notifyLoginError(error, message);
          appDispatch({ type: 'LOGIN_FAILURE', error: message });
        }
      } finally {
        setPasskeyLoading(false);
      }
    },
    [appDispatch, notifyLoginError, passkeySupported, setStatusMessage],
  );

  useEffect(() => {
    if (!magicToken) {
      return;
    }
    if (magicLoginPendingRef.current) {
      return;
    }
    if (attemptedMagicTokenRef.current === magicToken) {
      return;
    }
    if (appStatusRef.current === 'authenticated') {
      clearMagicParamsFromUrl();
      return;
    }

    let cancelled = false;
    attemptedMagicTokenRef.current = magicToken;

    const attemptMagicLogin = async () => {
      magicLoginPendingRef.current = true;
      setMagicLoginPending(true);
      preferredTenantRef.current = magicPreferredTenantId;
      appDispatch({ type: 'LOGIN_REQUEST' });
      setStatusMessage('Signing you in…', 'info');

      try {
        const payload: {
          magic_token: string;
          username?: string;
          preferred_tenant_id?: string;
        } = {
          magic_token: magicToken,
        };
        if (magicUsername) {
          payload.username = magicUsername;
        }
        if (magicPreferredTenantId) {
          payload.preferred_tenant_id = magicPreferredTenantId;
        }

        const data = await performLogin(payload) as AuthResponse;
        if (cancelled) {
          return;
        }

        if (data?.access_token && Array.isArray(data.tenants)) {
          appDispatch({
            type: 'TENANT_SELECTION_REQUIRED',
            selectionToken: data.access_token,
            tenants: data.tenants || [],
          });
          setStatusMessage('Select a tenant to continue.', 'info');
          return;
        }

        if (!data?.access_token) {
          throw new Error('Invalid login response.');
        }

        appDispatch({
          type: 'LOGIN_SUCCESS',
          token: data.access_token,
          tenant: data.tenant || null,
        });
        setStatusMessage('Login successful.', 'success');
        preferredTenantRef.current = null;
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error?.response?.data?.error || 'Magic link login failed.';
        notifyLoginError(error, message);
        appDispatch({ type: 'LOGIN_FAILURE', error: message });
        preferredTenantRef.current = null;
      } finally {
        if (!cancelled) {
          setMagicLoginPending(false);
          magicLoginPendingRef.current = false;
          clearMagicParamsFromUrl();
        }
      }
    };

    attemptMagicLogin();

    return () => {
      cancelled = true;
      magicLoginPendingRef.current = false;
      setMagicLoginPending(false);
    };
  }, [
    appDispatch,
    clearMagicParamsFromUrl,
    magicToken,
    magicUsername,
    magicPreferredTenantId,
    notifyLoginError,
    setStatusMessage,
  ]);

  useEffect(() => {
    const preferredTenantId = preferredTenantRef.current;
    if (!preferredTenantId) {
      return;
    }
    if (!tenantSelection?.tenants?.length) {
      return;
    }
    if (selectingTenantId) {
      return;
    }
    const match = tenantSelection.tenants.find((tenant) => tenant.id === preferredTenantId);
    if (!match) {
      preferredTenantRef.current = null;
      return;
    }
    handleTenantSelect(match);
    preferredTenantRef.current = null;
  }, [handleTenantSelect, selectingTenantId, tenantSelection]);

  const handleSignup = useCallback(
    async (rawUsername) => {
      const username = rawUsername?.trim?.() || '';
      if (!username) {
        setStatusMessage('Choose a username to create your account.', 'error');
        return;
      }
      if (!passkeySupported) {
        setStatusMessage('Passkeys are not supported in this browser.', 'error');
        return;
      }

      setSignupLoading(true);
      try {
        const startData = await startSignup(username) as {
          signup_token?: string;
          challenge?: { challengeId?: string; publicKey?: PublicKeyCredentialCreationOptions };
        };
        const signupToken = startData.signup_token;
        const challengePayload = startData.challenge;
        const challengeId = challengePayload?.challengeId;
        const publicKeyOptions = challengePayload?.publicKey;

        if (!signupToken || !challengeId || !publicKeyOptions) {
          throw new Error('Invalid signup challenge response.');
        }

        const publicKey = preparePublicKeyCreationOptions({ publicKey: publicKeyOptions });
        setStatusMessage('Confirm the passkey prompt to finish creating your account.', 'info');
        const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;

        if (!credential) {
          setStatusMessage('Signup cancelled.', 'info');
          return;
        }

        if (!(credential instanceof PublicKeyCredential)) {
          setStatusMessage('Unexpected credential response.', 'error');
          return;
        }

        const serialized = serializeRegistrationCredential(credential);
        const finishPayload = {
          signup_token: signupToken,
          credential: serialized,
        };

        const finishData = await finishSignup(finishPayload) as AuthResponse;

        if (finishData?.access_token && Array.isArray(finishData.tenants)) {
          appDispatch({
            type: 'TENANT_SELECTION_REQUIRED',
            selectionToken: finishData.access_token,
            tenants: finishData.tenants || [],
          });
          setStatusMessage('Select a tenant to continue.', 'info');
          return;
        }

        if (!finishData?.access_token) {
          throw new Error('Invalid signup response.');
        }

        appDispatch({
          type: 'LOGIN_SUCCESS',
          token: finishData.access_token,
          tenant: finishData.tenant || null,
        });
        setStatusMessage('Account created. Welcome!', 'success');
      } catch (error) {
        if (error?.name === 'NotAllowedError') {
          setStatusMessage('Signup cancelled.', 'info');
        } else if (error?.response?.status === 409) {
          setStatusMessage('This passkey is already registered. Try signing in instead.', 'error');
        } else if (error?.response?.data?.error) {
          setStatusMessage(error.response.data.error, 'error');
        } else {
          const message = error?.message || 'Failed to create account.';
          setStatusMessage(message, 'error');
        }
      } finally {
        setSignupLoading(false);
      }
    },
    [appDispatch, passkeySupported, setStatusMessage],
  );

  const redirectTarget = useMemo(() => {
    const target = String(location.state?.from ?? '');
    if (target.startsWith('/')) {
      return target;
    }
    return '/documents';
  }, [location.state]);

  if (!['logged-out', 'authenticating', 'selecting-tenant'].includes(appStatus)) {
    return <Navigate to={redirectTarget} replace />;
  }

  return (
    <div className="app-shell">
      <LoginView
        status={status}
        tenantSelection={tenantSelection}
        onSelectTenant={handleTenantSelect}
        onCancelSelection={handleCancelSelection}
        selectingTenantId={selectingTenantId}
        onPasskeyLogin={handlePasskeyLogin}
        passkeySupported={passkeySupported}
        passkeyLoading={passkeyLoading}
        onSignup={handleSignup}
        signupSupported={signupSupported}
        signupLoading={signupLoading}
        magicLoginPending={magicLoginPending}
        initialUsername={magicLoginParams.username || ''}
      />
    </div>
  );
};

export default LoginRoute;
