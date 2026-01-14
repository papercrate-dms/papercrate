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
import { extractMagicParams, clearMagicParamsFromUrl } from '../utils/authUrlUtils';
import { useAutoMagicLogin } from '../login/useAutoMagicLogin';
import { LoginActionState, TenantOption, TenantSelectionState } from '../login/types';
import { AxiosError } from 'axios';

// Local utility types
type StatusVariant = 'info' | 'success' | 'error';
interface StatusMessage {
  message: string;
  variant: StatusVariant;
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

  // Unified State
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [activeAction, setActiveAction] = useState<LoginActionState>('idle');
  const [selectingTenantId, setSelectingTenantId] = useState<string | null>(null);

  const passkeySupported = isWebAuthnAvailable();
  const signupSupported = passkeySupported;

  // Logic Extraction: URL Params
  const magicLoginParams = useMemo(() =>
    extractMagicParams(location.search, location.hash || window.location.hash),
    [location.search, location.hash]);

  const {
    token: magicToken,
    username: magicUsername,
    preferredTenantId: magicPreferredTenantId,
  } = magicLoginParams;

  // Refs for tracking async flows vs unmounts or state changes
  const preferredTenantRef = useRef<string | null>(magicPreferredTenantId);

  const setStatusMessage = useCallback((message: string | null, variant: StatusVariant = 'info') => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error: any, fallbackMessage: string, variant: StatusVariant = 'error') =>
      reportLoginError(error, { message: fallbackMessage, variant }),
    [reportLoginError],
  );

  // Helper: Post-Auth Success Handler
  const handleAuthCompletion = useCallback((data: AuthResponse, successMessage: string | null) => {
    if (data?.access_token && Array.isArray(data.tenants)) {
      appDispatch({
        type: 'TENANT_SELECTION_REQUIRED',
        selectionToken: data.access_token,
        tenants: data.tenants || [],
      });
      setStatusMessage(null);
      setActiveAction('idle');
      return;
    }

    if (!data?.access_token) {
      throw new Error('Invalid authentication response.');
    }

    appDispatch({
      type: 'LOGIN_SUCCESS',
      token: data.access_token,
      tenant: data.tenant || null,
    });
    if (successMessage) setStatusMessage(successMessage, 'success');
    // We stay in 'idle' or transition out of route
  }, [appDispatch, setStatusMessage]);

  // Handler: Manual Magic Login
  const handleManualMagicLogin = useCallback(
    async (token: string) => {
      const trimmed = token?.trim?.() || '';
      if (!trimmed) {
        setStatusMessage('Please enter a magic token.', 'error');
        return;
      }

      setActiveAction('magic');
      appDispatch({ type: 'LOGIN_REQUEST' });
      setStatusMessage('Verifying token…', 'info');

      try {
        const payload = { magic_token: trimmed };
        const data = await performLogin(payload) as AuthResponse;
        handleAuthCompletion(data, null);
      } catch (error) {
        const message = (error instanceof AxiosError) ? error.response?.data?.error : 'Magic link login failed.';
        notifyLoginError(error, message);
        appDispatch({ type: 'LOGIN_FAILURE', error: message });
        setActiveAction('idle');
      }
    },
    [appDispatch, handleAuthCompletion, notifyLoginError, setStatusMessage],
  );

  // Logic Extraction: Auto Magic Login Hook
  useAutoMagicLogin(magicToken, appStatus, async (token: string) => {
    // If we are already doing something, ignore
    if (activeAction !== 'idle') return;

    setActiveAction('magic');
    preferredTenantRef.current = magicPreferredTenantId;
    appDispatch({ type: 'LOGIN_REQUEST' });

    try {
      const payload: {
        magic_token: string;
        username?: string;
        preferred_tenant_id?: string;
      } = { magic_token: token };

      if (magicUsername) payload.username = magicUsername;
      if (magicPreferredTenantId) payload.preferred_tenant_id = magicPreferredTenantId;

      const data = await performLogin(payload) as AuthResponse;
      handleAuthCompletion(data, null);
      // preferredTenantRef is used in the effect below to auto-select tenant
    } catch (error) {
      const message = (error instanceof AxiosError) ? error.response?.data?.error : 'Magic link login failed.';
      notifyLoginError(error, message);
      appDispatch({ type: 'LOGIN_FAILURE', error: message });
      setActiveAction('idle');
      preferredTenantRef.current = null;
    }
  });

  // Handler: Tenant Selection
  const handleTenantSelect = useCallback(
    async (tenant: TenantOption) => {
      if (!tenantSelection?.selectionToken || !tenant?.id) {
        return;
      }

      try {
        setSelectingTenantId(tenant.id); // UI specific
        setActiveAction('tenant'); // Logical state
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
        handleAuthCompletion({ access_token: accessToken, tenant: data.tenant });
      } catch (error) {
        const message = (error instanceof AxiosError) ? error.response?.data?.error : 'Failed to finalize login.';
        notifyLoginError(error, message, 'error');
        setActiveAction('idle');
      } finally {
        setSelectingTenantId(null);
      }
    },
    [appDispatch, notifyLoginError, setStatusMessage, tenantSelection],
  );

  // Logic: Auto-Select Preferred Tenant
  useEffect(() => {
    const preferredId = preferredTenantRef.current;
    if (!preferredId || !tenantSelection?.tenants?.length || selectingTenantId) {
      return;
    }
    const match = tenantSelection.tenants.find((t) => t.id === preferredId);
    if (!match) {
      preferredTenantRef.current = null;
      return;
    }
    handleTenantSelect(match);
    preferredTenantRef.current = null;
  }, [handleTenantSelect, selectingTenantId, tenantSelection]);

  const handleCancelSelection = useCallback(() => {
    appDispatch({ type: 'CLEAR_TENANT_SELECTION' });
    setStatusMessage(null);
    setActiveAction('idle');
  }, [appDispatch, setStatusMessage]);

  // Handler: Passkey Login
  const handlePasskeyLogin = useCallback(
    async (rawUsername: string) => {
      const username = rawUsername?.trim?.() || '';
      if (!username) {
        setStatusMessage('Enter your username before using a passkey.', 'error');
        return;
      }
      if (!passkeySupported) {
        setStatusMessage('Passkeys are not supported in this browser.', 'error');
        return;
      }

      setActiveAction('passkey');
      appDispatch({ type: 'LOGIN_REQUEST' });
      try {
        // Step 1: Start
        const startData = await startPasskeyLogin(username) as { challengeId?: string, publicKey?: PublicKeyCredentialRequestOptions };
        const { challengeId, publicKey: publicKeyOptions } = startData;

        if (!challengeId || !publicKeyOptions) {
          throw new Error('Invalid passkey challenge response.');
        }

        const publicKey = preparePublicKeyRequestOptions({ publicKey: publicKeyOptions });
        setStatusMessage('Confirm the passkey prompt to continue.', 'info');

        // Step 2: Browser Interaction
        const assertion = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
        if (!assertion) {
          setStatusMessage('Passkey login cancelled.', 'info');
          setActiveAction('idle');
          return;
        }

        const serialized = serializeAuthenticationCredential(assertion);
        const finishPayload = { challengeId, credential: serialized };

        // Step 3: Finish
        const finishData = await finishPasskeyLogin(finishPayload) as AuthResponse;
        handleAuthCompletion(finishData, null);
        handleAuthCompletion(finishData, null);
      } catch (error) {
        const err = error as any;
        if (err?.name === 'NotAllowedError') { // WebAuthn error, not Axios
          setStatusMessage('Passkey login cancelled.', 'info');
        } else if (err instanceof AxiosError) {
          if (err.response?.status === 404) {
            setStatusMessage('No passkey registered for this username. Create an account first.', 'error');
            appDispatch({ type: 'LOGIN_FAILURE', error: 'passkey not registered' });
          } else if (err.response?.status === 400 && err.response?.data?.error) {
            const msg = err.response.data.error;
            setStatusMessage(msg, 'error');
            appDispatch({ type: 'LOGIN_FAILURE', error: msg });
          } else {
            const message = err.response?.data?.error || 'Passkey login failed.';
            notifyLoginError(err, message);
            appDispatch({ type: 'LOGIN_FAILURE', error: message });
          }
        } else {
          const message = err.message || 'Passkey login failed.';
          notifyLoginError(err, message);
          appDispatch({ type: 'LOGIN_FAILURE', error: message });
        }
        setActiveAction('idle');
      }
    },
    [appDispatch, handleAuthCompletion, notifyLoginError, passkeySupported, setStatusMessage],
  );

  // Handler: Signup
  const handleSignup = useCallback(
    async (rawUsername: string) => {
      const username = rawUsername?.trim?.() || '';
      if (!username) {
        setStatusMessage('Choose a username to create your account.', 'error');
        return;
      }
      if (!passkeySupported) {
        setStatusMessage('Passkeys are not supported in this browser.', 'error');
        return;
      }

      setActiveAction('signup');
      try {
        const startData = await startSignup(username) as {
          signup_token?: string;
          challenge?: { challengeId?: string; publicKey?: PublicKeyCredentialCreationOptions };
        };
        const signupToken = startData.signup_token;
        const challengePayload = startData.challenge;

        if (!signupToken || !challengePayload?.challengeId || !challengePayload?.publicKey) {
          throw new Error('Invalid signup challenge response.');
        }

        const publicKey = preparePublicKeyCreationOptions({ publicKey: challengePayload.publicKey });
        setStatusMessage('Confirm the passkey prompt to finish creating your account.', 'info');

        const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
        if (!credential) {
          setStatusMessage('Signup cancelled.', 'info');
          setActiveAction('idle');
          return;
        }

        const serialized = serializeRegistrationCredential(credential);
        const finishPayload = { signup_token: signupToken, credential: serialized };

        const finishData = await finishSignup(finishPayload) as AuthResponse;
        handleAuthCompletion(finishData, null);
      } catch (error) {
        const err = error as any;
        if (err?.name === 'NotAllowedError') {
          setStatusMessage('Signup cancelled.', 'info');
        } else if (err instanceof AxiosError) {
          if (err.response?.status === 409) {
            setStatusMessage('This passkey is already registered. Try signing in instead.', 'error');
          } else if (err.response?.data?.error) {
            setStatusMessage(err.response.data.error, 'error');
          } else {
            const message = 'Failed to create account.';
            setStatusMessage(message, 'error');
          }
        } else {
          const message = err?.message || 'Failed to create account.';
          setStatusMessage(message, 'error');
        }
        setActiveAction('idle');
      }
    },
    [appDispatch, handleAuthCompletion, passkeySupported, setStatusMessage],
  );

  const redirectTarget = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = String((location.state as any)?.from ?? '');
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
        onSignup={handleSignup}
        signupSupported={signupSupported}
        activeAction={activeAction}
        initialUsername={magicLoginParams.username || ''}
        onMagicLogin={handleManualMagicLogin}
      />
    </div>
  );
};

export default LoginRoute;
