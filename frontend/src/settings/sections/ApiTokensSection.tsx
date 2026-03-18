import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Identifier } from '../../types/identifiers';
import { formatDateTime } from '../../utils/date';

interface ApiTokenEntry {
  id?: Identifier;
  label?: string;
  expires_at?: string;
  created_at?: string;
  last_used_at?: string;
  revoked_at?: string;
  revoked_reason?: string;
  revokedReason?: string;
  transports?: string[];
  capability_set_id?: Identifier;
  [key: string]: unknown;
}

interface CapabilitySetEntry {
  id?: Identifier;
  slug?: string;
  label?: string;
  capabilities?: string[];
}

interface CapabilitySetOption {
  value: string;
  label: string;
  capabilities: string[];
  sourceId?: Identifier;
  slug?: string;
}

interface CapabilitySelectionOption {
  value: string;
  label: string;
}

interface CopyFeedbackState {
  type: 'success' | 'error';
  message: string;
}

interface ApiTokensSectionProps {
  tokens?: ApiTokenEntry[];
  loading?: boolean;
  creating?: boolean;
  deletingId?: Identifier | null;
  regeneratingId?: Identifier | null;
  createdToken?: string | null;
  capabilitySets?: CapabilitySetEntry[];
  capabilitySetsLoading?: boolean;
  capabilities?: string[];
  capabilitiesLoading?: boolean;
  onRefresh?: () => void;
  onCreate?: (payload: { label?: string; expires_at?: string; capability_set_id: Identifier | string }) => Promise<unknown> | unknown;
  onDelete?: (tokenId: Identifier) => Promise<unknown> | unknown;
  onRegenerate?: (tokenId: Identifier) => Promise<unknown> | unknown;
  onDismissCreatedToken?: () => void;
  onRefreshCapabilitySets?: () => void;
  onRefreshCapabilities?: () => void;
}

const ApiTokensSection = ({
  tokens = [],
  loading = false,
  creating = false,
  deletingId = null,
  regeneratingId = null,
  createdToken = null,
  capabilitySets = [],
  capabilitySetsLoading = false,
  capabilities = [],
  capabilitiesLoading = false,
  onRefresh,
  onCreate,
  onDelete,
  onRegenerate,
  onDismissCreatedToken,
  onRefreshCapabilitySets,
  onRefreshCapabilities,
}: ApiTokensSectionProps) => {
  const [newTokenLabel, setNewTokenLabel] = useState('');
  const [newTokenExpires, setNewTokenExpires] = useState('');
  const [newTokenCapabilitySetId, setNewTokenCapabilitySetId] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const supportsClipboardWrite = Boolean(navigator.clipboard?.writeText);
  const [canCopyToken, setCanCopyToken] = useState<boolean>(supportsClipboardWrite);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedbackState | null>(null);

  const capabilitySetOptions = useMemo<CapabilitySetOption[]>(
    () =>
      capabilitySets.map((set) => ({
        value: set.id != null ? String(set.id) : set.slug ?? '',
        label: `${set.label || set.slug || set.id || 'Capability set'}`,
        capabilities: Array.isArray(set.capabilities)
          ? set.capabilities.map((cap) => String(cap ?? ''))
          : [],
        sourceId: set.id,
        slug: set.slug,
      })),
    [capabilitySets],
  );

  const capabilitySetMap = useMemo<Record<string, CapabilitySetOption>>(
    () => {
      const entries = capabilitySetOptions.map((option) => [option.value, option] as const);
      return Object.fromEntries(entries);
    },
    [capabilitySetOptions],
  );

  const capabilitySelectionOptions = useMemo<CapabilitySelectionOption[]>(() => (
    Array.isArray(capabilities)
      ? capabilities.map((capability) => {
        const capabilityText = `${capability ?? ''}`;
        if (!capabilityText.includes(':')) {
          return { value: capability, label: capabilityText };
        }
        const [namespace, action] = capabilityText.split(':');
        if (!namespace || !action) {
          return { value: capability, label: capabilityText };
        }
        const formattedNamespace = `${namespace.charAt(0).toUpperCase()}${namespace.slice(1)}`;
        const formattedAction = action.replace(/_/g, ' ');
        return {
          value: capability,
          label: `${formattedNamespace}: ${formattedAction}`,
        };
      })
      : []
  ), [capabilities]);

  const capabilityLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    capabilitySelectionOptions.forEach(({ value, label }) => {
      map.set(value, label || String(value));
    });
    return map;
  }, [capabilitySelectionOptions]);

  const formatCapabilityLabel = useCallback((value: string) => (
    capabilityLabelMap.get(value) || String(value)
  ), [capabilityLabelMap]);

  useEffect(() => {
    if (!capabilitySetOptions.length) {
      setNewTokenCapabilitySetId('');
      return;
    }
    if (!newTokenCapabilitySetId
      || !capabilitySetOptions.some((option) => option.value === newTokenCapabilitySetId)) {
      setNewTokenCapabilitySetId(capabilitySetOptions[0].value);
    }
  }, [capabilitySetOptions, newTokenCapabilitySetId]);

  const selectedTokenCapabilitySetCapabilities = useMemo(
    () => capabilitySetMap[newTokenCapabilitySetId]?.capabilities || [],
    [capabilitySetMap, newTokenCapabilitySetId],
  );



  const handleCopyToken = useCallback(async () => {
    if (!createdToken || !canCopyToken) {
      return;
    }

    const showSuccess = () =>
      setCopyFeedback({ type: 'success', message: 'Token copied to clipboard.' });
    const showFailure = () =>
      setCopyFeedback({
        type: 'error',
        message:
          'Copy failed. Your browser may require HTTPS access; please select the token manually.',
      });

    try {
      await navigator.clipboard.writeText(createdToken);
      showSuccess();
      return;
    } catch {
      // Some browsers expose writeText but still reject outside secure context
      setCanCopyToken(false);
    }

    showFailure();
  }, [createdToken, canCopyToken]);

  const handleDismissSecret = useCallback(() => {
    setCopyFeedback(null);
    onDismissCreatedToken?.();
  }, [onDismissCreatedToken]);

  useEffect(() => {
    setCopyFeedback(null);
    setCanCopyToken(Boolean(navigator.clipboard?.writeText));
  }, [createdToken]);

  const handleNewCapabilitySetChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setFormError(null);
    setNewTokenCapabilitySetId(event.target.value);
  }, []);

  const handleCreateToken = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);
      let normalizedLabel = newTokenLabel.trim();
      if (normalizedLabel.length === 0) {
        normalizedLabel = undefined;
      }

      let normalizedExpires;
      if (newTokenExpires) {
        const parsed = new Date(newTokenExpires);
        if (Number.isNaN(parsed.getTime())) {
          setFormError('Enter a valid expiration date.');
          return;
        }
        normalizedExpires = parsed.toISOString();
      }

      if (!capabilitySetOptions.length) {
        setFormError('Capability sets are still loading.');
        return;
      }

      const selectedCapabilitySetId = newTokenCapabilitySetId || capabilitySetOptions[0]?.value;
      if (!selectedCapabilitySetId) {
        setFormError('Select a capability set.');
        return;
      }

      const resolvedCapabilitySetId = capabilitySetMap[selectedCapabilitySetId]?.sourceId ?? selectedCapabilitySetId;

      const result = await onCreate?.({
        label: normalizedLabel,
        expires_at: normalizedExpires,
        capability_set_id: resolvedCapabilitySetId,
      });

      if (result !== false) {
        setNewTokenLabel('');
        setNewTokenExpires('');
        setNewTokenCapabilitySetId(capabilitySetOptions[0]?.value || '');
        setFormError(null);
      }
    },
    [
      capabilitySetOptions,
      capabilitySetMap,
      newTokenCapabilitySetId,
      newTokenExpires,
      newTokenLabel,
      onCreate,
    ],
  );

  const handleRegenerateToken = useCallback(
    async (token: ApiTokenEntry) => {
      if (!token?.id) {
        return;
      }
      await onRegenerate?.(token.id);
    },
    [onRegenerate],
  );

  return (
    <div className="settings-section">
      <h4>API tokens</h4>

      <p>
        API tokens use predefined capability sets. Choose the set that matches the access you need when
        creating or updating a token.
      </p>

      {createdToken ? (
        <div className="settings-notice">
          <p>
            Copy this token now; you will not be able to view it again after closing this window.
          </p>
          <pre className="token-display">{createdToken}</pre>
          <div className="settings-notice__actions">
            {canCopyToken ? (
              <button type="button" className="secondary" onClick={handleCopyToken}>
                Copy token
              </button>
            ) : null}
            <button type="button" onClick={handleDismissSecret}>
              Dismiss
            </button>
          </div>
          {copyFeedback ? (
            <p className={copyFeedback.type === 'error' ? 'settings-form__error' : 'settings-status'}>
              {copyFeedback.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <form className="settings-form" onSubmit={handleCreateToken}>
        <div className="settings-form__field">
          <label htmlFor="api-token-label">Label</label>
          <input
            id="api-token-label"
            type="text"
            value={newTokenLabel}
            onChange={(event) => setNewTokenLabel(event.target.value)}
            placeholder="Personal API token"
          />
        </div>
        <div className="settings-form__field">
          <label htmlFor="api-token-expires">Expires at</label>
          <input
            id="api-token-expires"
            type="datetime-local"
            value={newTokenExpires}
            onChange={(event) => setNewTokenExpires(event.target.value)}
          />
        </div>
        <div className="settings-form__field settings-form__field--full">
          <label htmlFor="api-token-capability-set">Capability set</label>
          <select
            id="api-token-capability-set"
            value={newTokenCapabilitySetId}
            onChange={handleNewCapabilitySetChange}
            disabled={
              creating
              || capabilitySetsLoading
              || !capabilitySetOptions.length
            }
          >
            {capabilitySetOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {capabilitySetsLoading ? (
            <small>Loading capability sets…</small>
          ) : null}
          {!capabilitySetsLoading && !capabilitySetOptions.length ? (
            <small>No capability sets available yet.</small>
          ) : null}
        </div>
        <div className="settings-form__field settings-form__field--full">
          {selectedTokenCapabilitySetCapabilities.length ? (
            <div className="settings-capability-list">
              {selectedTokenCapabilitySetCapabilities.map((value) => (
                <span key={value} className="settings-capability-list__item badge tag-chip">
                  <span className="tag-chip__label">{formatCapabilityLabel(value)}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="settings-capability-picker__placeholder">No capabilities selected.</span>
          )}
          {capabilitiesLoading ? (
            <small>Loading capabilities…</small>
          ) : null}
        </div>
        <div className="settings-form__actions">
          <button
            type="submit"
            disabled={
              creating
              || capabilitySetsLoading
              || !capabilitySetOptions.length
            }
          >
            {creating ? 'Creating…' : 'Create token'}
          </button>
        </div>
      </form>
      {formError ? (
        <p className="settings-form__error">{formError}</p>
      ) : null}

      {loading && !tokens.length ? (
        <p className="settings-empty">Loading tokens…</p>
      ) : null}

      {!loading && !tokens.length ? (
        <p className="settings-empty">No API tokens yet.</p>
      ) : null}

      {tokens.length ? (
        <table className="settings-table">
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Created</th>
              <th scope="col">Last used</th>
              <th scope="col">Expires</th>
              <th scope="col">Capability set</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => {
              const isRevoked = Boolean(token?.revoked_at);
              const capabilityKey = token?.capability_set_id != null
                ? String(token.capability_set_id)
                : null;
              const selectedSet = capabilityKey ? capabilitySetMap[capabilityKey] : null;
              const capabilitySetLabel = selectedSet?.label
                || selectedSet?.slug
                || token.capability_set_id
                || '—';

              return (
                <tr key={token.id} className={isRevoked ? 'is-revoked' : undefined}>
                  <td>{token.label || '—'}</td>
                  <td>{formatDateTime(token.created_at)}</td>
                  <td>{formatDateTime(token.last_used_at)}</td>
                  <td>{formatDateTime(token.expires_at)}</td>
                  <td>
                    <div className="settings-capability-set">
                      <span className="settings-capability-set__label">{capabilitySetLabel}</span>
                    </div>
                    {capabilitySetsLoading ? (
                      <small>Loading capability sets…</small>
                    ) : null}
                  </td>
                  <td className="settings-table__actions">
                    {isRevoked ? (
                      <span className="settings-status">Revoked</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => handleRegenerateToken(token)}
                          disabled={
                            regeneratingId === token.id || deletingId === token.id
                          }
                        >
                          {regeneratingId === token.id ? 'Regenerating…' : 'Regenerate'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => token.id && onDelete?.(token.id)}
                          disabled={
                            deletingId === token.id || regeneratingId === token.id
                            || !token.id
                          }
                        >
                          {deletingId === token.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};

export default ApiTokensSection;
