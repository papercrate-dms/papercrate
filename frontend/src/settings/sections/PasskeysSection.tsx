import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { PasskeyRecord, RegisterPasskeyResult } from '../usePasskeys';
import { formatDateTime } from '../../utils/date';

interface PasskeysSectionProps {
  passkeys?: PasskeyRecord[];
  passkeysSupported?: boolean | null;
  passkeysLoading?: boolean;
  registeringPasskey?: boolean;
  revokingPasskeyId?: string | null;
  onRefreshPasskeys?: () => void | Promise<void>;
  onRegisterPasskey?: (args: { nickname?: string }) => Promise<RegisterPasskeyResult | undefined>;
  onRevokePasskey?: (id: string, reason?: string) => Promise<void>;
}

const PasskeysSection = ({
  passkeys = [],
  passkeysSupported = null,
  passkeysLoading = false,
  registeringPasskey = false,
  revokingPasskeyId = null,
  onRefreshPasskeys,
  onRegisterPasskey,
  onRevokePasskey,
}: PasskeysSectionProps) => {
  const [newPasskeyNickname, setNewPasskeyNickname] = useState('');

  const hasPasskeys = useMemo(() => Array.isArray(passkeys) && passkeys.length > 0, [passkeys]);

  const handlePasskeyRefresh = useCallback(() => {
    onRefreshPasskeys?.();
  }, [onRefreshPasskeys]);

  const handlePasskeyRegister = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nickname = newPasskeyNickname.trim();
      const result = await onRegisterPasskey?.({ nickname });
      if (result?.ok) {
        setNewPasskeyNickname('');
      }
    },
    [newPasskeyNickname, onRegisterPasskey],
  );

  const handlePasskeyRevoke = useCallback(
    async (passkey) => {
      if (!passkey?.id) {
        return;
      }
      const reasonInput = window.prompt('Optional reason for revoking this passkey:', '');
      const reason = reasonInput ? reasonInput.trim() : undefined;
      await onRevokePasskey?.(passkey.id, reason);
    },
    [onRevokePasskey],
  );

  return (
    <div className="settings-section">
      <div className="settings-actions">
        <button
          type="button"
          className="secondary"
          onClick={handlePasskeyRefresh}
          disabled={passkeysLoading}
        >
          {passkeysLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {passkeysSupported === false ? (
        <p className="settings-empty">Passkeys are not enabled for this account.</p>
      ) : (
        <>
          <form className="settings-form" onSubmit={handlePasskeyRegister}>
            <div className="settings-form__field">
              <label htmlFor="passkey-nickname">Nickname (optional)</label>
              <input
                id="passkey-nickname"
                type="text"
                placeholder="e.g. MacBook"
                value={newPasskeyNickname}
                onChange={(event) => setNewPasskeyNickname(event.target.value)}
                disabled={registeringPasskey}
              />
            </div>
            <div className="settings-form__actions">
              <button type="submit" disabled={registeringPasskey}>
                {registeringPasskey ? 'Registering…' : 'Register passkey'}
              </button>
            </div>
          </form>

          {passkeysLoading && !hasPasskeys ? (
            <p className="settings-empty">Loading passkeys…</p>
          ) : null}

          {!passkeysLoading && !hasPasskeys ? (
            <p className="settings-empty">No passkeys registered yet.</p>
          ) : null}

          {hasPasskeys ? (
            <table className="settings-table">
              <thead>
                <tr>
                  <th scope="col">Nickname</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Transports</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {passkeys.map((passkey) => {
                  const createdAt = passkey.created_at || passkey.createdAt;
                  const lastUsedAt = passkey.last_used_at || passkey.lastUsedAt;
                  const revokedAt = passkey.revoked_at || passkey.revokedAt;
                  const revokedReason = passkey.revoked_reason || passkey.revokedReason;
                  const revoked = Boolean(revokedAt);
                  const transports = Array.isArray(passkey.transports)
                    ? passkey.transports.filter(Boolean)
                    : [];

                  return (
                    <tr key={passkey.id} className={revoked ? 'is-revoked' : undefined}>
                      <td>{passkey.nickname || '—'}</td>
                      <td>{formatDateTime(createdAt)}</td>
                      <td>{formatDateTime(lastUsedAt)}</td>
                      <td>{transports.length ? transports.join(', ') : '—'}</td>
                      <td>
                        {revoked
                          ? revokedReason
                            ? `Revoked (${revokedReason})`
                            : 'Revoked'
                          : 'Active'}
                      </td>
                      <td className="settings-table__actions">
                        {revoked ? (
                          <span className="settings-status">Revoked</span>
                        ) : (
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handlePasskeyRevoke(passkey)}
                            disabled={revokingPasskeyId === passkey.id}
                          >
                            {revokingPasskeyId === passkey.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </div>
  );
};

export default PasskeysSection;
