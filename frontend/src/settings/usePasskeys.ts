import { useState, useCallback } from 'react';
import { useAppState } from '../lib/store/appState';
import { useStatusToast } from '../lib/context/StatusToastContext';
/* global PublicKeyCredentialCreationOptions, CredentialCreationOptions */

import {
  isWebAuthnAvailable,
  preparePublicKeyCreationOptions,
  serializeRegistrationCredential,
} from '../utils/webauthn';
import {
  deletePasskey,
  finishPasskeyRegistration,
  listPasskeys,
  startPasskeyRegistration,
} from '../lib/api/apiClient';
import type { PasskeyId } from '../types/identifiers';

type ApiError = {
  response?: {
    status?: number;
    data?: {
      error?: string;
    };
  };
  name?: string;
};

export interface PasskeyRecord {
  id?: PasskeyId;
  nickname?: string;
  created_at?: string;
  createdAt?: string;
  last_used_at?: string;
  lastUsedAt?: string;
  revoked_at?: string;
  revokedAt?: string;
  revoked_reason?: string;
  revokedReason?: string;
  transports?: string[];
  [key: string]: unknown;
}

interface PasskeyChallengeResponse {
  challengeId?: string;
  challenge_id?: string;
  publicKey?: PublicKeyCredentialCreationOptions;
  public_key?: PublicKeyCredentialCreationOptions;
  challenge?: {
    publicKey?: PublicKeyCredentialCreationOptions;
  };
  publicKeyCredentialCreationOptions?: PublicKeyCredentialCreationOptions;
}

interface PasskeyRegisterPayload {
  challengeId: string;
  credential: unknown;
  nickname?: string;
}

type RegisterPasskeyFailureReason = 'unsupported' | 'busy' | 'cancelled' | 'error';
export type RegisterPasskeyResult =
  | { ok: true }
  | { ok: false; reason: RegisterPasskeyFailureReason; message?: string };

type RevokePasskeyFailureReason = 'missing-id' | 'error';
type RevokePasskeyResult =
  | { ok: true }
  | { ok: false; reason: RevokePasskeyFailureReason; message?: string };

import useNotifyApiError from '../hooks/useNotifyApiError';

interface UsePasskeysArgs { }

interface UsePasskeysResult {
  passkeys: PasskeyRecord[];
  passkeysSupported: boolean | null;
  passkeysLoading: boolean;
  registeringPasskey: boolean;
  revokingPasskeyId: PasskeyId | null;
  refreshPasskeys: () => Promise<void>;
  registerPasskey: (options?: { nickname?: string }) => Promise<RegisterPasskeyResult>;
  revokePasskey: (
    passkeyId: PasskeyId,
    reason?: string,
  ) => Promise<RevokePasskeyResult>;
}

const usePasskeys = (_: UsePasskeysArgs = {}): UsePasskeysResult => {
  const { token } = useAppState();
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [passkeysSupported, setPasskeysSupported] = useState<boolean | null>(null);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [revokingPasskeyId, setRevokingPasskeyId] = useState<PasskeyId | null>(null);
  const { showToast } = useStatusToast();
  const notifyApiError = useNotifyApiError();

  const refreshPasskeys = useCallback(async (): Promise<void> => {
    if (!token) {
      return;
    }
    setPasskeysLoading(true);
    try {
      const passkeyData = await listPasskeys();
      setPasskeys(passkeyData);
      setPasskeysSupported(true);
    } catch (error) {
      const status = (error as ApiError)?.response?.status;
      if (status === 400 || status === 404) {
        setPasskeysSupported(false);
        setPasskeys([]);
      } else {
        notifyApiError(error, 'Failed to load passkeys.');
      }
    } finally {
      setPasskeysLoading(false);
    }
  }, [notifyApiError, token]);

  const registerPasskey = useCallback(
    async ({ nickname }: { nickname?: string } = {}): Promise<RegisterPasskeyResult> => {
      if (!isWebAuthnAvailable()) {
        setPasskeysSupported(false);
        showToast('Passkeys are not supported in this browser.', 'error');
        return { ok: false, reason: 'unsupported' };
      }
      if (registeringPasskey) {
        return { ok: false, reason: 'busy' };
      }

      setRegisteringPasskey(true);
      try {
        const data = await startPasskeyRegistration();
        const challengeData = data as PasskeyChallengeResponse | undefined;
        const challengeId = challengeData?.challengeId || challengeData?.challenge_id;
        const publicKeyOptions =
          challengeData?.publicKey
          || challengeData?.public_key
          || challengeData?.challenge?.publicKey
          || challengeData?.publicKeyCredentialCreationOptions;

        if (!challengeId || !publicKeyOptions) {
          throw new Error('Invalid passkey challenge response.');
        }

        const publicKey = preparePublicKeyCreationOptions({ publicKey: publicKeyOptions });
        const credential = (await navigator.credentials.create({
          publicKey,
        } as CredentialCreationOptions)) as PublicKeyCredential | null;

        if (!credential) {
          return { ok: false, reason: 'cancelled' };
        }

        const serialized = serializeRegistrationCredential(credential);
        const payload: PasskeyRegisterPayload = {
          challengeId,
          credential: serialized,
        };
        const trimmedNickname = nickname?.trim?.();
        if (trimmedNickname) {
          payload.nickname = trimmedNickname;
        }

        await finishPasskeyRegistration(payload);
        await refreshPasskeys();
        setPasskeysSupported(true);
        showToast('Passkey registered.', 'success');
        return { ok: true };
      } catch (error) {
        const typedError = error as ApiError;
        if (typedError?.name === 'NotAllowedError') {
          showToast('Passkey registration cancelled.', 'info');
          return { ok: false, reason: 'cancelled' };
        }

        const status = typedError?.response?.status;
        if (status === 400 || status === 404) {
          setPasskeysSupported(false);
        }

        const message = typedError?.response?.data?.error || 'Failed to register passkey.';
        notifyApiError(error, message);
        return { ok: false, reason: 'error', message };
      } finally {
        setRegisteringPasskey(false);
      }
    },
    [notifyApiError, refreshPasskeys, registeringPasskey, showToast],
  );

  const revokePasskey = useCallback(
    async (
      passkeyId: PasskeyId,
      reason?: string,
    ): Promise<RevokePasskeyResult> => {
      if (passkeyId == null) {
        return { ok: false, reason: 'missing-id' };
      }
      setRevokingPasskeyId(passkeyId);
      try {
        await deletePasskey(passkeyId, { reason });
        await refreshPasskeys();
        showToast('Passkey revoked.', 'success');
        return { ok: true };
      } catch (error) {
        const message = (error as ApiError)?.response?.data?.error || 'Failed to revoke passkey.';
        notifyApiError(error, message);
        return { ok: false, reason: 'error', message };
      } finally {
        setRevokingPasskeyId(null);
      }
    },
    [notifyApiError, refreshPasskeys, showToast],
  );

  return {
    passkeys,
    passkeysSupported,
    passkeysLoading,
    registeringPasskey,
    revokingPasskeyId,
    refreshPasskeys,
    registerPasskey,
    revokePasskey,
  };
};

export default usePasskeys;
