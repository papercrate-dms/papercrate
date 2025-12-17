import React, {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { IconX } from '../../components/icons';
import CapabilityDropdown, { CapabilityDropdownOption } from '../components/CapabilityDropdown';
import type { CapabilitySetId, CapabilityValue } from '../../types/identifiers';

interface CapabilitySet {
  id: CapabilitySetId;
  slug?: string;
  label?: string;
  capabilities?: CapabilityValue[] | null;
  is_system?: boolean;
  cap_version?: number | null;
}

interface CapabilitySetMutationPayload {
  slug?: string;
  label?: string;
  capabilities: CapabilityValue[];
}

type RefreshHandler = (() => void | Promise<void>) | undefined;
type CreateCapabilitySetHandler = (payload: CapabilitySetMutationPayload) => Promise<boolean | CapabilitySet | void | null> | boolean | CapabilitySet | void | null;
type UpdateCapabilitySetHandler = (
  id: CapabilitySetId,
  payload: CapabilitySetMutationPayload,
) => Promise<boolean | CapabilitySet | void | null> | boolean | CapabilitySet | void | null;
type DeleteCapabilitySetHandler = (id: CapabilitySetId) => Promise<boolean | void | null> | boolean | void | null;

interface CapabilitySetsSectionProps {
  capabilitySets?: CapabilitySet[];
  capabilitySetsLoading?: boolean;
  creatingCapabilitySet?: boolean;
  savingCapabilitySetId?: CapabilitySetId | null;
  deletingCapabilitySetId?: CapabilitySetId | null;
  supportsCapabilitySetLabels?: boolean;
  capabilities?: CapabilityValue[];
  capabilitiesLoading?: boolean;
  onRefreshCapabilitySets?: RefreshHandler;
  onRefreshCapabilities?: RefreshHandler;
  onRefresh?: RefreshHandler;
  onCreateCapabilitySet?: CreateCapabilitySetHandler;
  onUpdateCapabilitySet?: UpdateCapabilitySetHandler;
  onDeleteCapabilitySet?: DeleteCapabilitySetHandler;
}

type CapabilityOptionInput = CapabilityDropdownOption | CapabilityValue | null;



const resolveCapabilityValue = (option: CapabilityOptionInput): CapabilityValue | null => {
  if (option == null) {
    return null;
  }
  if (typeof option === 'string' || typeof option === 'number') {
    return option;
  }
  if (option.value != null) {
    return option.value as CapabilityValue;
  }
  if (option.id != null) {
    return option.id as CapabilityValue;
  }
  return null;
};

const CapabilitySetsSection: React.FC<CapabilitySetsSectionProps> = ({
  capabilitySets = [],
  capabilitySetsLoading = false,
  creatingCapabilitySet = false,
  savingCapabilitySetId = null,
  deletingCapabilitySetId = null,
  supportsCapabilitySetLabels = false,
  capabilities = [],
  capabilitiesLoading = false,
  onRefreshCapabilitySets,
  onRefreshCapabilities,
  onRefresh,
  onCreateCapabilitySet,
  onUpdateCapabilitySet,
  onDeleteCapabilitySet,
}) => {
  const [newCapabilitySetSlug, setNewCapabilitySetSlug] = useState('');
  const [newCapabilitySetLabel, setNewCapabilitySetLabel] = useState('');
  const [newCapabilitySetCapabilities, setNewCapabilitySetCapabilities] = useState<CapabilityValue[]>([]);
  const [capabilitySetFormError, setCapabilitySetFormError] = useState<string | null>(null);

  const [editingCapabilitySetId, setEditingCapabilitySetId] = useState<CapabilitySetId | null>(null);
  const [editCapabilitySetSlug, setEditCapabilitySetSlug] = useState('');
  const [editCapabilitySetLabel, setEditCapabilitySetLabel] = useState('');
  const [editCapabilitySetCapabilities, setEditCapabilitySetCapabilities] = useState<CapabilityValue[]>([]);
  const [capabilitySetEditError, setCapabilitySetEditError] = useState<string | null>(null);

  const capabilitySelectionOptions = useMemo<CapabilityDropdownOption[]>(() => (
    (capabilities ?? []).map((capability) => {
      const capabilityLabel = `${capability ?? ''}`;
      if (!capabilityLabel.includes(':')) {
        return { value: capability, label: capabilityLabel };
      }
      const [namespace, action] = capabilityLabel.split(':');
      if (!namespace || !action) {
        return { value: capability, label: capabilityLabel };
      }
      const formattedNamespace = `${namespace.charAt(0).toUpperCase()}${namespace.slice(1)}`;
      const formattedAction = action.replace(/_/g, ' ');
      return {
        value: capability,
        label: `${formattedNamespace}: ${formattedAction}`,
      };
    })
  ), [capabilities]);

  const capabilityLabelMap = useMemo(() => {
    const map = new Map<CapabilityValue, string>();
    capabilitySelectionOptions.forEach(({ value, label }) => {
      if (value == null) {
        return;
      }
      map.set(value, label || String(value));
    });
    return map;
  }, [capabilitySelectionOptions]);

  const capabilityOrder = useMemo(() => {
    const order = new Map<CapabilityValue, number>();
    capabilitySelectionOptions.forEach((option, index) => {
      if (option.value == null) {
        return;
      }
      order.set(option.value, index);
    });
    return order;
  }, [capabilitySelectionOptions]);

  const sortCapabilityValues = useCallback((values: CapabilityValue[] | null) => {
    if (!Array.isArray(values)) {
      return [];
    }
    return [...values].sort((a, b) => {
      const indexA = capabilityOrder.has(a) ? capabilityOrder.get(a)! : Number.MAX_SAFE_INTEGER;
      const indexB = capabilityOrder.has(b) ? capabilityOrder.get(b)! : Number.MAX_SAFE_INTEGER;
      if (indexA === indexB) {
        return String(a).localeCompare(String(b));
      }
      return indexA - indexB;
    });
  }, [capabilityOrder]);

  const formatCapabilityLabel = useCallback((value: CapabilityValue) => (
    capabilityLabelMap.get(value) || String(value)
  ), [capabilityLabelMap]);

  const capabilitySetOptions = useMemo(
    () => capabilitySets.map((set) => ({
      value: set.id,
      label: set.label || set.slug || set.id,
      capabilities: Array.isArray(set.capabilities) ? set.capabilities : [],
      isSystem: Boolean(set?.is_system),
      version: set?.cap_version != null ? Number(set.cap_version) : null,
    })),
    [capabilitySets],
  );

  const hasCapabilitySets = capabilitySetOptions.length > 0;
  const columnCount = supportsCapabilitySetLabels ? 6 : 5;

  const handleCapabilitySetsRefresh = useCallback(() => {
    if (onRefreshCapabilitySets) {
      onRefreshCapabilitySets();
    } else {
      onRefresh?.();
    }
    onRefreshCapabilities?.();
  }, [onRefresh, onRefreshCapabilities, onRefreshCapabilitySets]);

  const handleAddCapabilityToNewSet = useCallback((option: CapabilityOptionInput) => {
    const value = resolveCapabilityValue(option);
    if (!value) {
      return;
    }
    setCapabilitySetFormError(null);
    setNewCapabilitySetCapabilities((previous) => {
      if (previous.includes(value)) {
        return previous;
      }
      return sortCapabilityValues([...previous, value]);
    });
  }, [sortCapabilityValues]);

  const handleRemoveCapabilityFromNewSet = useCallback((value: CapabilityValue) => {
    setCapabilitySetFormError(null);
    setNewCapabilitySetCapabilities((previous) => previous.filter((item) => item !== value));
  }, []);

  const handleCreateCapabilitySetSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCapabilitySetFormError(null);

      if (!Array.isArray(newCapabilitySetCapabilities) || newCapabilitySetCapabilities.length === 0) {
        setCapabilitySetFormError('Select at least one capability.');
        return;
      }

      if (!capabilitySelectionOptions.length) {
        setCapabilitySetFormError('Capabilities are still loading.');
        return;
      }

      const payload: CapabilitySetMutationPayload = {
        slug: newCapabilitySetSlug,
        label: newCapabilitySetLabel,
        capabilities: sortCapabilityValues(newCapabilitySetCapabilities),
      };

      const result = await onCreateCapabilitySet?.(payload);
      if (result === false) {
        setCapabilitySetFormError('Failed to create capability set.');
        return;
      }

      setNewCapabilitySetSlug('');
      setNewCapabilitySetLabel('');
      setNewCapabilitySetCapabilities([]);
      setCapabilitySetFormError(null);
    },
    [
      capabilitySelectionOptions,
      newCapabilitySetCapabilities,
      newCapabilitySetLabel,
      newCapabilitySetSlug,
      onCreateCapabilitySet,
      sortCapabilityValues,
    ],
  );

  const handleStartEditCapabilitySet = useCallback((capabilitySet: CapabilitySet | null) => {
    if (!capabilitySet) {
      return;
    }
    setCapabilitySetEditError(null);
    setEditingCapabilitySetId(capabilitySet.id);
    setEditCapabilitySetSlug(capabilitySet.slug || '');
    setEditCapabilitySetLabel(capabilitySet.label || '');
    setEditCapabilitySetCapabilities(
      sortCapabilityValues(Array.isArray(capabilitySet.capabilities) ? capabilitySet.capabilities : []),
    );
  }, [sortCapabilityValues]);

  const handleCancelEditCapabilitySet = useCallback(() => {
    setEditingCapabilitySetId(null);
    setEditCapabilitySetSlug('');
    setEditCapabilitySetLabel('');
    setEditCapabilitySetCapabilities([]);
    setCapabilitySetEditError(null);
  }, []);

  const handleAddCapabilityToEditSet = useCallback((option: CapabilityOptionInput) => {
    const value = resolveCapabilityValue(option);
    if (!value) {
      return;
    }
    setCapabilitySetEditError(null);
    setEditCapabilitySetCapabilities((previous) => {
      if (previous.includes(value)) {
        return previous;
      }
      return sortCapabilityValues([...previous, value]);
    });
  }, [sortCapabilityValues]);

  const handleRemoveCapabilityFromEditSet = useCallback((value: CapabilityValue) => {
    setCapabilitySetEditError(null);
    setEditCapabilitySetCapabilities((previous) => previous.filter((item) => item !== value));
  }, []);

  const handleUpdateCapabilitySetSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editingCapabilitySetId) {
        return;
      }
      if (!Array.isArray(editCapabilitySetCapabilities) || editCapabilitySetCapabilities.length === 0) {
        setCapabilitySetEditError('Select at least one capability.');
        return;
      }

      const payload: CapabilitySetMutationPayload = {
        slug: editCapabilitySetSlug,
        label: editCapabilitySetLabel,
        capabilities: sortCapabilityValues(editCapabilitySetCapabilities),
      };

      const result = await onUpdateCapabilitySet?.(editingCapabilitySetId, payload);
      if (result === false) {
        setCapabilitySetEditError('Failed to update capability set.');
        return;
      }

      handleCancelEditCapabilitySet();
    },
    [
      editCapabilitySetCapabilities,
      editCapabilitySetLabel,
      editCapabilitySetSlug,
      editingCapabilitySetId,
      handleCancelEditCapabilitySet,
      onUpdateCapabilitySet,
      sortCapabilityValues,
    ],
  );

  const handleDeleteCapabilitySet = useCallback(
    async (capabilitySet: CapabilitySet | null) => {
      if (!capabilitySet?.id) {
        return;
      }
      const displayName = capabilitySet.slug || capabilitySet.label || capabilitySet.id;
      const confirmed = window.confirm(`Delete capability set "${displayName}"?`);
      if (!confirmed) {
        return;
      }
      const result = await onDeleteCapabilitySet?.(capabilitySet.id);
      if (result === false) {
        setCapabilitySetEditError('Failed to delete capability set.');
      }
    },
    [onDeleteCapabilitySet],
  );

  useEffect(() => {
    if (!editingCapabilitySetId) {
      return;
    }
    const exists = capabilitySets.some((set) => set.id === editingCapabilitySetId);
    if (!exists) {
      handleCancelEditCapabilitySet();
    }
  }, [capabilitySets, editingCapabilitySetId, handleCancelEditCapabilitySet]);

  return (
    <div className="settings-section">
      <div className="settings-actions">
        <button
          type="button"
          className="secondary"
          onClick={handleCapabilitySetsRefresh}
          disabled={capabilitySetsLoading}
        >
          {capabilitySetsLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p>
        Capability sets bundle permissions that you can assign to API tokens and user memberships.
      </p>

      <form className="settings-form" onSubmit={handleCreateCapabilitySetSubmit}>
        <div className="settings-form__field">
          <label htmlFor="capability-set-slug">Slug</label>
          <input
            id="capability-set-slug"
            type="text"
            value={newCapabilitySetSlug}
            onChange={(event) => setNewCapabilitySetSlug(event.target.value)}
            placeholder="e.g. api_readonly"
            disabled={creatingCapabilitySet || capabilitySetsLoading}
          />
          <small>Leave blank to generate a slug automatically.</small>
        </div>
        {supportsCapabilitySetLabels ? (
          <div className="settings-form__field">
            <label htmlFor="capability-set-label">Label</label>
            <input
              id="capability-set-label"
              type="text"
              value={newCapabilitySetLabel}
              onChange={(event) => setNewCapabilitySetLabel(event.target.value)}
              placeholder="Friendly name (optional)"
              disabled={creatingCapabilitySet || capabilitySetsLoading}
            />
          </div>
        ) : null}
        <div className="settings-form__field settings-form__field--full">
          <label htmlFor="capability-set-capabilities">Capabilities</label>
          <div className="settings-capability-picker" id="capability-set-capabilities">
            <CapabilityDropdown
              id="capability-set-capabilities"
              options={capabilitySelectionOptions}
              selectedValues={newCapabilitySetCapabilities}
              onSelect={handleAddCapabilityToNewSet}
              onDeselect={handleRemoveCapabilityFromNewSet}
              formatLabel={formatCapabilityLabel}
              disabled={
                creatingCapabilitySet
                || capabilitySetsLoading
                || capabilitiesLoading
                || !capabilitySelectionOptions.length
              }
              loading={capabilitiesLoading}
              summaryLabel="capabilities"
            />
            {newCapabilitySetCapabilities.length ? (
              <div className="settings-capability-picker__chips">
                {newCapabilitySetCapabilities.map((value) => (
                  <span key={value} className="badge tag-chip">
                    <span className="tag-chip__label">{formatCapabilityLabel(value)}</span>
                    <button
                      type="button"
                      className="tag-chip__remove"
                      onClick={() => handleRemoveCapabilityFromNewSet(value)}
                      aria-label={`Remove capability ${formatCapabilityLabel(value)}`}
                    >
                      <IconX className="icon-inline" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="settings-capability-picker__placeholder">No capabilities selected.</span>
            )}
            {capabilitiesLoading ? (
              <small>Loading capabilities…</small>
            ) : null}
            {!capabilitiesLoading && !capabilitySelectionOptions.length ? (
              <small>No capabilities available.</small>
            ) : null}
          </div>
        </div>
        <div className="settings-form__actions">
          <button
            type="submit"
            disabled={
              creatingCapabilitySet
              || capabilitySetsLoading
              || capabilitiesLoading
              || !capabilitySelectionOptions.length
            }
          >
            {creatingCapabilitySet ? 'Creating…' : 'Create capability set'}
          </button>
        </div>
      </form>
      {capabilitySetFormError ? (
        <p className="settings-form__error">{capabilitySetFormError}</p>
      ) : null}
      {capabilitySetsLoading && !hasCapabilitySets ? (
        <p className="settings-empty">Loading capability sets…</p>
      ) : null}

      {!capabilitySetsLoading && !hasCapabilitySets ? (
        <p className="settings-empty">No capability sets yet.</p>
      ) : null}

      {hasCapabilitySets ? (
        <table className="settings-table">
          <thead>
            <tr>
              <th scope="col">Slug</th>
              {supportsCapabilitySetLabels ? <th scope="col">Label</th> : null}
              <th scope="col">Capabilities</th>
              <th scope="col">System</th>
              <th scope="col">Version</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {capabilitySets.map((set) => {
              const isSystem = Boolean(set?.is_system);
              const isEditing = editingCapabilitySetId === set.id;
              const capabilityList = sortCapabilityValues(
                Array.isArray(set?.capabilities) ? set.capabilities : [],
              );
              const saving = savingCapabilitySetId === set.id;
              const deleting = deletingCapabilitySetId === set.id;

              return (
                <React.Fragment key={set.id}>
                  <tr className={isSystem ? 'is-system' : undefined}>
                    <td>{set.slug || '—'}</td>
                    {supportsCapabilitySetLabels ? (
                      <td>{set.label || '—'}</td>
                    ) : null}
                    <td>
                      {capabilityList.length
                        ? capabilityList.map((value) => formatCapabilityLabel(value)).join(', ')
                        : '—'}
                    </td>
                    <td>{isSystem ? 'Yes' : 'No'}</td>
                    <td>{set.cap_version != null ? Number(set.cap_version) : '—'}</td>
                    <td className="settings-table__actions">
                      {isSystem ? (
                        <span className="settings-status">System set</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => handleStartEditCapabilitySet(set)}
                            disabled={
                              saving
                              || deleting
                              || capabilitySetsLoading
                            }
                          >
                            {isEditing ? 'Editing…' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteCapabilitySet(set)}
                            disabled={deleting || saving || capabilitySetsLoading}
                          >
                            {deleting ? 'Deleting…' : 'Delete'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {isEditing ? (
                    <tr className="settings-table__edit-row">
                      <td colSpan={columnCount}>
                        <form className="settings-form" onSubmit={handleUpdateCapabilitySetSubmit}>
                          <div className="settings-form__field">
                            <label htmlFor="edit-capability-set-slug">Slug</label>
                            <input
                              id="edit-capability-set-slug"
                              type="text"
                              value={editCapabilitySetSlug}
                              onChange={(event) => setEditCapabilitySetSlug(event.target.value)}
                              disabled={saving || capabilitySetsLoading}
                            />
                          </div>
                          {supportsCapabilitySetLabels ? (
                            <div className="settings-form__field">
                              <label htmlFor="edit-capability-set-label">Label</label>
                              <input
                                id="edit-capability-set-label"
                                type="text"
                                value={editCapabilitySetLabel}
                                onChange={(event) => setEditCapabilitySetLabel(event.target.value)}
                                disabled={saving || capabilitySetsLoading}
                              />
                            </div>
                          ) : null}
                          <div className="settings-form__field settings-form__field--full">
                            <label htmlFor={`edit-capability-set-${set.id}-capabilities`}>
                              Capabilities
                            </label>
                            <div
                              className="settings-capability-picker"
                              id={`edit-capability-set-${set.id}-capabilities`}
                            >
                              <CapabilityDropdown
                                id={`edit-capability-set-${set.id}-capabilities`}
                                options={capabilitySelectionOptions}
                                selectedValues={editCapabilitySetCapabilities}
                                onSelect={handleAddCapabilityToEditSet}
                                onDeselect={handleRemoveCapabilityFromEditSet}
                                formatLabel={formatCapabilityLabel}
                                disabled={
                                  saving
                                  || capabilitySetsLoading
                                  || capabilitiesLoading
                                  || !capabilitySelectionOptions.length
                                }
                                loading={capabilitiesLoading}
                                summaryLabel="capabilities"
                              />
                              {editCapabilitySetCapabilities.length ? (
                                <div className="settings-capability-picker__chips">
                                  {editCapabilitySetCapabilities.map((value) => (
                                    <span key={value} className="badge tag-chip">
                                      <span className="tag-chip__label">{formatCapabilityLabel(value)}</span>
                                      <button
                                        type="button"
                                        className="tag-chip__remove"
                                        onClick={() => handleRemoveCapabilityFromEditSet(value)}
                                        aria-label={`Remove capability ${formatCapabilityLabel(value)}`}
                                        disabled={saving}
                                      >
                                        <IconX className="icon-inline" aria-hidden="true" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="settings-capability-picker__placeholder">
                                  No capabilities selected.
                                </span>
                              )}
                              {capabilitiesLoading ? (
                                <small>Loading capabilities…</small>
                              ) : null}
                              {!capabilitiesLoading && !capabilitySelectionOptions.length ? (
                                <small>No capabilities available.</small>
                              ) : null}
                            </div>
                          </div>
                          <div className="settings-form__actions">
                            <button
                              type="submit"
                              disabled={
                                saving
                                || capabilitySetsLoading
                                || capabilitiesLoading
                                || !capabilitySelectionOptions.length
                              }
                            >
                              {saving ? 'Saving…' : 'Save changes'}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleCancelEditCapabilitySet}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                        {capabilitySetEditError ? (
                          <p className="settings-form__error">{capabilitySetEditError}</p>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};

export default CapabilitySetsSection;
