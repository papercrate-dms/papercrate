import React, { useCallback, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  getTagColorStyle,
  HEX_COLOR_PATTERN,
  generateRandomTagColor,
} from '../utils/colors';
import type { Tag } from '../types/documents';

interface TagsPanelProps {
  tags?: Tag[];
  onCreateTag?: (payload: { label: string; color: string | null }) => Promise<void>;
  onUpdateTag?: (id: string, payload: { label: string; color: string | null }) => Promise<void>;
  onDeleteTag?: (id: string) => Promise<void>;
  onNotify?: (message: string, variant?: string) => void;
}

function TagsPanel({
  tags = [],
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onNotify,
}: TagsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createLabel, setCreateLabel] = useState('');
  const [createColor, setCreateColor] = useState('');
  const [creating, setCreating] = useState(false);

  const startEdit = useCallback((tag: Tag) => {
    setEditingId(tag.id);
    setDraftLabel(tag.label);
    setDraftColor(tag.color ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraftLabel('');
    setDraftColor('');
    setSaving(false);
  }, []);

  const colorPickerValue = useMemo(() => {
    if (!draftColor) {
      return '#3366ff';
    }
    const match = HEX_COLOR_PATTERN.exec(draftColor.trim());
    if (!match) {
      return '#3366ff';
    }
    return `#${match[1].toLowerCase()}`;
  }, [draftColor]);

  const handleSave = useCallback(async () => {
    if (!editingId) return;

    const trimmedLabel = draftLabel.trim();
    if (!trimmedLabel) {
      onNotify?.('Tag label cannot be empty.', 'error');
      return;
    }

    const trimmedColor = draftColor.trim();
    const colorPattern = /^#([0-9a-fA-F]{6})$/;
    if (trimmedColor && !colorPattern.test(trimmedColor)) {
      onNotify?.('Colors must use the #RRGGBB format.', 'error');
      return;
    }

    setSaving(true);
    try {
      await onUpdateTag?.(editingId, {
        label: trimmedLabel,
        color: trimmedColor ? trimmedColor : null,
      });
      cancelEdit();
    } catch (updateError) {
      const message = (updateError as Error)?.message || 'Failed to update tag.';
      onNotify?.(message, 'error');
    } finally {
      setSaving(false);
    }
  }, [editingId, draftLabel, draftColor, onUpdateTag, cancelEdit, onNotify]);

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

  const handleDelete = useCallback(
    async (tag: Tag) => {
      if (!tag?.id || !onDeleteTag) {
        return;
      }

      setDeletingId(tag.id);
      try {
        await onDeleteTag(tag.id);
        if (editingId === tag.id) {
          cancelEdit();
        }
      } catch (deleteError) {
        const message = (deleteError as Error)?.message || 'Failed to delete tag.';
        onNotify?.(message, 'error');
      } finally {
        setDeletingId(null);
      }
    },
    [onDeleteTag, editingId, cancelEdit, onNotify],
  );

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!onCreateTag) {
        return;
      }

      const trimmedLabel = createLabel.trim();
      if (!trimmedLabel) {
        onNotify?.('Tag label cannot be empty.', 'error');
        return;
      }

      const trimmedColor = createColor.trim();
      const colorPattern = /^#([0-9a-fA-F]{6})$/;
      if (trimmedColor && !colorPattern.test(trimmedColor)) {
        onNotify?.('Colors must use the #RRGGBB format.', 'error');
        return;
      }

      setCreating(true);
      try {
        await onCreateTag({
          label: trimmedLabel,
          color: trimmedColor ? trimmedColor : null,
        });
        setCreateLabel('');
        setCreateColor('');
      } catch (createError) {
        const message = (createError as Error)?.message || 'Failed to create tag.';
        onNotify?.(message, 'error');
      } finally {
        setCreating(false);
      }
    },
    [createLabel, createColor, onCreateTag, onNotify],
  );

  return (
    <section className="manage-panel">
      <form className="manage-panel__create" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New tag label"
          value={createLabel}
          onChange={(event) => setCreateLabel(event.target.value)}
          disabled={creating}
        />
        <input
          type="color"
          className="manage-table__color-picker"
          value={createColor || '#3366ff'}
          onChange={(event) => setCreateColor(event.target.value)}
          disabled={creating}
          aria-label="Tag color (optional)"
        />
        <button
          type="button"
          className="secondary"
          onClick={() => setCreateColor(generateRandomTagColor())}
          disabled={creating}
        >
          Random color
        </button>
        {createColor && (
          <button
            type="button"
            className="secondary"
            onClick={() => setCreateColor('')}
            disabled={creating}
          >
            Clear
          </button>
        )}
        <button type="submit" disabled={creating || !createLabel.trim()}>
          {creating ? 'Creating\u2026' : 'Create'}
        </button>
      </form>

      <div className="manage-panel__body">
        {tags.length === 0 ? (
          <div className="empty-state">No tags created yet.</div>
        ) : (
          <div className="manage-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Color</th>
                  <th scope="col" className="numeric">
                    Usage
                  </th>
                  <th scope="col" className="actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => {
                  const isEditing = editingId === tag.id;
                  return (
                    <tr key={tag.id} className={isEditing ? 'editing' : ''}>
                      <td className="manage-table__label">
                        {isEditing ? (
                          <input
                            type="text"
                            className="manage-table__label-input"
                            value={draftLabel}
                            onChange={(event) => setDraftLabel(event.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={saving || deletingId === tag.id}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="badge tag-chip"
                            style={getTagColorStyle(tag.color) || undefined}
                          >
                            {tag.label}
                          </span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div className="manage-table__color-editor">
                            <input
                              type="color"
                              className="manage-table__color-picker"
                              value={colorPickerValue}
                              onChange={(event) => setDraftColor(event.target.value)}
                              disabled={saving || deletingId === tag.id}
                              aria-label="Pick tag color"
                            />
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setDraftColor(generateRandomTagColor())}
                              disabled={saving || deletingId === tag.id}
                            >
                              Random color
                            </button>
                            {draftColor && (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setDraftColor('')}
                                disabled={saving || deletingId === tag.id}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        ) : tag.color ? (
                          <span
                            className="manage-table__swatch"
                            style={{ backgroundColor: tag.color }}
                            aria-label={`Tag color ${tag.color}`}
                          />
                        ) : (
                          <span className="meta">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="numeric">{tag.usage_count ?? 0}</td>
                      <td className="actions">
                        {isEditing ? (
                          <div className="manage-table__row-actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleSave}
                              disabled={saving || deletingId === tag.id}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={cancelEdit}
                              disabled={saving || deletingId === tag.id}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDelete(tag)}
                              disabled={deletingId === tag.id}
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <div className="manage-table__row-actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => startEdit(tag)}
                              disabled={deletingId === tag.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDelete(tag)}
                              disabled={deletingId === tag.id}
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

export default TagsPanel;
