import {
  Dispatch,
  SetStateAction,
  SyntheticEvent,
  useCallback,
  useRef,
  useState,
} from 'react';

type FocusableInput = (HTMLInputElement | HTMLTextAreaElement) & {
  select?: () => void;
};

type InlineRenameOptions<TEntity> = {
  getCurrentValue?: (entity: TEntity) => string | null;
  getEntityId?: (entity: TEntity) => string | null;
};

type InlineRenameHandler = (
  id: string,
  value: string,
) => boolean | void | Promise<boolean | void>;

type InlineRenameReturn<TEntity> = {
  editingId: string | null;
  draftValue: string;
  setDraftValue: Dispatch<SetStateAction<string>>;
  beginEditing: (entity?: TEntity | null, event?: SyntheticEvent | Event) => void;
  cancelEditing: (event?: SyntheticEvent | Event) => void;
  submitEditing: (entity?: TEntity | null) => Promise<boolean>;
  savingId: string | null;
  attachInputRef: (node: FocusableInput | null) => void;
};

const focusInput = (node: FocusableInput | null) => {
  if (!node) {
    return;
  }
  const applyFocus = () => {
    node.focus();
    node.select?.();
  };
  const raf = window.requestAnimationFrame;
  if (raf) {
    raf(applyFocus);
    return;
  }
  applyFocus();
};

const identity = (value: unknown) => value as string;

const defaultGetEntityId = <T,>(entity?: T | null) =>
  (entity as { id?: string } | null)?.id ?? null;

const useInlineRename = <TEntity,>(
  onRename?: InlineRenameHandler,
  {
    getCurrentValue = identity as (entity: TEntity) => string | null,
    getEntityId = defaultGetEntityId as (entity: TEntity) => string | null,
  }: InlineRenameOptions<TEntity> = {},
): InlineRenameReturn<TEntity> => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRef = useRef<FocusableInput | null>(null);

  const resetState = useCallback(() => {
    setEditingId(null);
    setDraftValue('');
    setSavingId(null);
    inputRef.current = null;
  }, []);

  const beginEditing = useCallback(
    (entity?: TEntity | null, event?: SyntheticEvent | Event) => {
      if (!entity) {
        return;
      }
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const entityId = getEntityId(entity);
      if (!entityId) {
        return;
      }
      const currentValue = getCurrentValue(entity) ?? '';
      setEditingId(entityId);
      setDraftValue(currentValue);
      setSavingId(null);
    },
    [getCurrentValue, getEntityId],
  );

  const cancelEditing = useCallback(
    (event?: SyntheticEvent | Event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      resetState();
    },
    [resetState],
  );

  const submitEditing = useCallback(
    async (entity?: TEntity | null) => {
      if (!entity) {
        return false;
      }
      const entityId = getEntityId(entity);
      if (!entityId || editingId !== entityId) {
        return false;
      }
      const trimmed = draftValue.trim();
      const currentValue = getCurrentValue(entity) ?? '';
      if (!trimmed || trimmed === currentValue) {
        resetState();
        return true;
      }
      if (!onRename) {
        resetState();
        return true;
      }
      setSavingId(entityId);
      try {
        const result = await onRename(entityId, trimmed);
        if (result === false) {
          return false;
        }
        resetState();
        return true;
      } catch {
        return false;
      } finally {
        setSavingId((current) => (current === entityId ? null : current));
      }
    },
    [draftValue, editingId, getCurrentValue, getEntityId, onRename, resetState],
  );

  const attachInputRef = useCallback((node: FocusableInput | null) => {
    if (node) {
      inputRef.current = node;
      focusInput(node);
    } else if (inputRef.current) {
      inputRef.current = null;
    }
  }, []);

  return {
    editingId,
    draftValue,
    setDraftValue,
    beginEditing,
    cancelEditing,
    submitEditing,
    savingId,
    attachInputRef,
  };
};

export default useInlineRename;
