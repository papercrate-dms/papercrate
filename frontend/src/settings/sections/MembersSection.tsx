import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import type { Identifier } from '../../types/identifiers';
import type { TenantUserSummary } from '../../lib/api/apiTypes';

interface CapabilitySet {
  id: Identifier;
  slug?: string;
  label?: string;
  is_system?: boolean;
}

interface MembersSectionProps {
  tenantUsers?: TenantUserSummary[];
  tenantUsersLoading?: boolean;
  savingTenantUserId?: Identifier | null;
  deletingTenantUserId?: Identifier | null;
  capabilitySets?: CapabilitySet[];
  capabilitySetsLoading?: boolean;
  onRefreshTenantUsers?: () => void | Promise<void>;
  onUpdateTenantUser?: (
    userId: Identifier,
    capabilitySetId: Identifier,
  ) => Promise<boolean | void | null> | boolean | void | null;
  onDeleteTenantUser?: (
    userId: Identifier,
  ) => Promise<boolean | void | null> | boolean | void | null;
}

const MembersSection: React.FC<MembersSectionProps> = ({
  tenantUsers = [],
  tenantUsersLoading = false,
  savingTenantUserId = null,
  deletingTenantUserId = null,
  capabilitySets = [],
  capabilitySetsLoading = false,
  onRefreshTenantUsers,
  onUpdateTenantUser,
  onDeleteTenantUser,
}) => {
  const [editingUserId, setEditingUserId] = useState<Identifier | null>(null);
  const [editCapabilitySetId, setEditCapabilitySetId] = useState<Identifier>('');
  const [editError, setEditError] = useState<string | null>(null);

  const hasUsers = tenantUsers.length > 0;

  const handleRefresh = useCallback(() => {
    onRefreshTenantUsers?.();
  }, [onRefreshTenantUsers]);

  const handleStartEdit = useCallback((user: TenantUserSummary) => {
    setEditError(null);
    setEditingUserId(user.user_id);
    setEditCapabilitySetId(user.capability_set_id || '');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingUserId(null);
    setEditCapabilitySetId('');
    setEditError(null);
  }, []);

  const handleEditSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setEditError(null);

      if (!editingUserId) {
        return;
      }
      if (!editCapabilitySetId) {
        setEditError('Select a capability set.');
        return;
      }

      const result = await onUpdateTenantUser?.(editingUserId, editCapabilitySetId);
      if (result === false) {
        setEditError('Failed to update member.');
        return;
      }

      handleCancelEdit();
    },
    [editCapabilitySetId, editingUserId, handleCancelEdit, onUpdateTenantUser],
  );

  const handleDelete = useCallback(
    async (user: TenantUserSummary) => {
      const confirmed = window.confirm(
        `Remove "${user.username}" from this tenant? They will lose access to all tenant data.`,
      );
      if (!confirmed) {
        return;
      }
      const result = await onDeleteTenantUser?.(user.user_id);
      if (result === false) {
        setEditError('Failed to remove member.');
      }
    },
    [onDeleteTenantUser],
  );

  useEffect(() => {
    if (!editingUserId) {
      return;
    }
    const exists = tenantUsers.some((u) => u.user_id === editingUserId);
    if (!exists) {
      handleCancelEdit();
    }
  }, [tenantUsers, editingUserId, handleCancelEdit]);

  const capabilitySetLabel = (id: Identifier | null | undefined): string => {
    if (!id) {
      return '\u2014';
    }
    const set = capabilitySets.find((s) => s.id === id);
    return set?.label || set?.slug || String(id);
  };

  return (
    <div className="settings-section">
      <div className="settings-actions">
        <button
          type="button"
          className="secondary"
          onClick={handleRefresh}
          disabled={tenantUsersLoading}
        >
          {tenantUsersLoading ? 'Refreshing\u2026' : 'Refresh'}
        </button>
      </div>

      <p>
        Manage who has access to this tenant and what permissions they have.
        To add new members, use the admin CLI.
      </p>

      {tenantUsersLoading && !hasUsers ? (
        <p className="settings-empty">Loading members\u2026</p>
      ) : null}

      {!tenantUsersLoading && !hasUsers ? (
        <p className="settings-empty">No members found.</p>
      ) : null}

      {hasUsers ? (
        <table className="settings-table">
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Capability set</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenantUsers.map((user) => {
              const isEditing = editingUserId === user.user_id;
              const saving = savingTenantUserId === user.user_id;
              const deleting = deletingTenantUserId === user.user_id;

              return (
                <React.Fragment key={user.user_id}>
                  <tr>
                    <td>{user.username}</td>
                    <td>{capabilitySetLabel(user.capability_set_id)}</td>
                    <td className="settings-table__actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleStartEdit(user)}
                        disabled={saving || deleting || tenantUsersLoading}
                      >
                        {isEditing ? 'Editing\u2026' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleDelete(user)}
                        disabled={deleting || saving || tenantUsersLoading}
                      >
                        {deleting ? 'Removing\u2026' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                  {isEditing ? (
                    <tr className="settings-table__edit-row">
                      <td colSpan={3}>
                        <form className="settings-form" onSubmit={handleEditSubmit}>
                          <div className="settings-form__field">
                            <label htmlFor={`edit-member-${user.user_id}-capset`}>
                              Capability set
                            </label>
                            <select
                              id={`edit-member-${user.user_id}-capset`}
                              value={editCapabilitySetId}
                              onChange={(e) => setEditCapabilitySetId(e.target.value)}
                              disabled={saving || capabilitySetsLoading}
                            >
                              <option value="">Select a capability set</option>
                              {capabilitySets.map((set) => (
                                <option key={set.id} value={set.id}>
                                  {set.label || set.slug || set.id}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="settings-form__actions">
                            <button
                              type="submit"
                              disabled={saving || !editCapabilitySetId}
                            >
                              {saving ? 'Saving\u2026' : 'Save changes'}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleCancelEdit}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                        {editError ? (
                          <p className="settings-form__error">{editError}</p>
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

export default MembersSection;
