import { useCallback, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { Correspondent } from '../types/documents';

export interface CorrespondentsPanelProps {
  correspondents?: Correspondent[];
  onCreate: (payload: { name: string }) => Promise<Correspondent | void>;
  onUpdate: (id: string, payload: { name: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNotify?: (message: string, variant?: string) => void;
}

function CorrespondentsPanel({
  correspondents = [],
  onCreate,
  onUpdate,
  onDelete,
  onNotify,
}: CorrespondentsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [createName, setCreateName] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startEdit = useCallback((correspondent: Correspondent) => {
    setEditingId(correspondent.id);
    setDraftName(correspondent.name);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraftName('');
    setSaving(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingId) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      onNotify?.('Correspondent name cannot be empty.', 'error');
      return;
    }

    setSaving(true);
    try {
      await onUpdate(editingId, { name: trimmed });
      cancelEdit();
    } catch (error) {
      onNotify?.('Failed to update correspondent.', 'error');
      console.error('[correspondents] update failed', error);
      setSaving(false);
    }
  }, [editingId, draftName, onUpdate, cancelEdit, onNotify]);

  const handleDelete = useCallback(
    async (correspondent: Correspondent) => {
      if (!correspondent?.id) return;
      setDeletingId(correspondent.id);
      try {
        await onDelete(correspondent.id);
        if (editingId === correspondent.id) {
          cancelEdit();
        }
      } catch (error) {
        onNotify?.('Failed to delete correspondent.', 'error');
        console.error('[correspondents] delete failed', error);
      } finally {
        setDeletingId(null);
      }
    },
    [onDelete, editingId, cancelEdit, onNotify],
  );

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = createName.trim();
      if (!trimmed) {
        onNotify?.('Correspondent name cannot be empty.', 'error');
        return;
      }
      setCreating(true);
      try {
        await onCreate({ name: trimmed });
        setCreateName('');
      } catch (error) {
        onNotify?.('Failed to create correspondent.', 'error');
        console.error('[correspondents] create failed', error);
      } finally {
        setCreating(false);
      }
    },
    [createName, onCreate, onNotify],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    },
    [handleSave, cancelEdit],
  );

  return (
    <section className="manage-panel">
      <form className="manage-panel__create" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New correspondent name"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          disabled={creating}
        />
        <button type="submit" disabled={creating || !createName.trim()}>
          {creating ? 'Creating\u2026' : 'Create'}
        </button>
      </form>

      <div className="manage-panel__body">
        {correspondents.length === 0 ? (
          <div className="empty-state">No correspondents created yet.</div>
        ) : (
          <div className="manage-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Correspondent</th>
                  <th scope="col" className="numeric">
                    Usage
                  </th>
                  <th scope="col" className="actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {correspondents.map((correspondent) => {
                  const isEditing = editingId === correspondent.id;
                  return (
                    <tr key={correspondent.id} className={isEditing ? 'editing' : ''}>
                      <td className="manage-table__label">
                        {isEditing ? (
                          <input
                            type="text"
                            className="manage-table__label-input"
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={saving}
                            autoFocus
                          />
                        ) : (
                          <span>{correspondent.name}</span>
                        )}
                      </td>
                      <td className="numeric">{correspondent.usage_count}</td>
                      <td className="actions">
                        {isEditing ? (
                          <div className="manage-table__row-actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleSave}
                              disabled={saving}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={cancelEdit}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="manage-table__row-actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => startEdit(correspondent)}
                              disabled={deletingId === correspondent.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDelete(correspondent)}
                              disabled={deletingId === correspondent.id}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default CorrespondentsPanel;
