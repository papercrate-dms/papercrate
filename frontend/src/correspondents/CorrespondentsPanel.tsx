import { useCallback, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { Correspondent } from '../types/documents';

export interface CorrespondentsPanelProps {
  correspondents?: Correspondent[];
  onRefresh?: () => void | Promise<void>;
  onCreate: (payload: { name: string }) => Promise<Correspondent | void>;
  onUpdate: (id: string, payload: { name: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNotify?: (message: string, variant?: string) => void;
}

function CorrespondentsPanel({
  correspondents = [],
  onRefresh,
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

  const renderUsage = useCallback((correspondent: Correspondent) => {
    return correspondent.usage_count;
  }, []);

  return (
    <section className="correspondents-panel">
      <div className="panel-section__header">
        <div className="panel-section__titles">
          <h2>Correspondents</h2>
          <div className="panel-section__subtitle">{correspondents.length} total</div>
        </div>
        <div className="header-actions correspondents-actions">
          <form className="correspondents-actions__form" onSubmit={handleCreate}>
            <input
              type="text"
              placeholder="New correspondent name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              disabled={creating}
            />
            <button type="submit" disabled={creating || !createName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
          <button
            className="secondary"
            type="button"
            onClick={onRefresh}
            disabled={saving || creating || Boolean(deletingId)}
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="panel-section__body tags-panel__body">
        {correspondents.length === 0 ? (
          <div className="empty-state">No correspondents created yet.</div>
        ) : (
          <div className="tags-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
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
                      <td className="tags-table__label">
                        {isEditing ? (
                          <input
                            className="tags-table__label-input"
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
                      <td className="numeric">{renderUsage(correspondent)}</td>
                      <td className="actions">
                        {isEditing ? (
                          <div className="tags-table__edit-controls">
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
                          <div className="tags-table__row-actions">
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
