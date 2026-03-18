import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useFloatingMenu from '../../../components/useFloatingMenu';
import { CheckIcon, CircleDashedCheckIcon, PlusIcon } from '../../../components/icons';

type AssignmentState = 'all' | 'partial' | 'none';

export interface SelectionAssignmentMenuItem {
  id?: string;
  label?: string;
  state?: AssignmentState;
  count?: number | null;
  total?: number | null;
  color?: string | null;
  value?: string;
  payload?: unknown;
}

export interface NormalizedSelectionAssignmentItem {
  id: string;
  label: string;
  state: AssignmentState;
  count: number | null;
  total: number | null;
  payload: unknown;
}

interface SelectionAssignmentMenuProps {
  label: React.ReactNode;
  items?: SelectionAssignmentMenuItem[];
  placeholder?: string;
  emptyMessage?: string;
  createLabel?: string;
  onToggle?: (item: NormalizedSelectionAssignmentItem) => Promise<void> | void;
  onCreate?: (value: string) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  triggerContent?: React.ReactNode;
  triggerClassName?: string;
  showStateIndicators?: boolean;
  showCounts?: boolean;
  onOpenMenu?: () => void;
  renderItemLabel?: (item: NormalizedSelectionAssignmentItem) => React.ReactNode;
  positionStrategy?: 'absolute' | 'fixed';
  closeOnSelection?: boolean;
  sortByState?: boolean;
  freezeSortOnOpen?: boolean;
}

const STATE_ORDER: Record<AssignmentState, number> = {
  all: 0,
  partial: 1,
  none: 2,
};

const normalizeItems = (items?: SelectionAssignmentMenuItem[]): NormalizedSelectionAssignmentItem[] =>
  (Array.isArray(items) ? items : [])
    .map<NormalizedSelectionAssignmentItem | null>((item) => {
      if (!item) {
        return null;
      }
      const trimmedLabel = item.label?.trim?.() || '';
      if (!trimmedLabel) {
        return null;
      }
      const state: AssignmentState = item.state === 'all'
        ? 'all'
        : item.state === 'partial'
          ? 'partial'
          : 'none';
      const numericCount = item.count ?? null;
      const numericTotal = item.total ?? null;
      return {
        id: item.id ?? trimmedLabel,
        label: trimmedLabel,
        state,
        count: numericCount,
        total: numericTotal,
        payload: item.payload ?? item,
      };
    })
    .filter((item): item is NormalizedSelectionAssignmentItem => Boolean(item));

const SelectionAssignmentMenu: React.FC<SelectionAssignmentMenuProps> = ({
  label,
  items = [],
  placeholder = 'Search…',
  emptyMessage = 'No entries',
  createLabel = 'Add',
  onToggle,
  onCreate,
  disabled = false,
  className,
  triggerContent = null,
  triggerClassName = 'quick-add__chip quick-add__trigger',
  showStateIndicators = true,
  showCounts = true,
  onOpenMenu,
  renderItemLabel,
  positionStrategy = 'absolute',
  closeOnSelection = true,
  sortByState = true,
  freezeSortOnOpen = false,
}) => {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [sortSnapshot, setSortSnapshot] = useState<Array<string> | null>(null);

  const {
    isOpen,
    toggle,
    close,
    menuRef,
    menuStyle,
    updatePosition,
  } = useFloatingMenu({
    anchorRef,
    align: 'center',
    positionStrategy,
    minWidth: 220,
  }) as {
    isOpen: boolean;
    toggle: () => void;
    close: () => void;
    menuRef: React.MutableRefObject<HTMLDivElement | null>;
    menuStyle: CSSProperties | null;
    updatePosition: () => void;
  };

  useEffect(() => {
    if (disabled && isOpen) {
      close();
    }
  }, [disabled, isOpen, close]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    setQuery('');
    setPending(false);
    const frame = requestAnimationFrame(() => {
      updatePosition();
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, updatePosition]);

  const normalizedItems = useMemo(() => normalizeItems(items), [items]);

  const sortedByStateItems = useMemo(() => {
    if (!sortByState) {
      return normalizedItems;
    }
    return normalizedItems.slice().sort((a, b) => {
      const stateDiff = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (stateDiff !== 0) {
        return stateDiff;
      }
      return a.label.localeCompare(b.label);
    });
  }, [normalizedItems, sortByState]);

  useEffect(() => {
    if (!isOpen || !freezeSortOnOpen || !sortByState) {
      setSortSnapshot(null);
      return;
    }
    setSortSnapshot((prev) => prev ?? sortedByStateItems.map((item) => item.id));
  }, [isOpen, freezeSortOnOpen, sortByState, sortedByStateItems]);

  const orderedItems = useMemo(() => {
    if (freezeSortOnOpen && sortSnapshot && sortByState) {
      const itemMap = new Map<string, NormalizedSelectionAssignmentItem>(
        sortedByStateItems.map((item) => [item.id, item]),
      );
      const seen = new Set<string>();
      const fromSnapshot = sortSnapshot
        .map((id) => {
          const entry = itemMap.get(id);
          if (entry) {
            seen.add(entry.id);
          }
          return entry || null;
        })
        .filter((entry): entry is NormalizedSelectionAssignmentItem => Boolean(entry));
      const remaining = sortedByStateItems.filter((item) => !seen.has(item.id));
      return [...fromSnapshot, ...remaining];
    }
    return sortedByStateItems;
  }, [freezeSortOnOpen, sortSnapshot, sortByState, sortedByStateItems]);

  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return orderedItems;
    }
    return orderedItems.filter((item) => item.label.toLowerCase().includes(search));
  }, [orderedItems, query]);

  const handleToggle = useCallback(
    async (item: NormalizedSelectionAssignmentItem) => {
      if (!onToggle) {
        return;
      }
      setPending(true);
      try {
        await onToggle(item);
        setPending(false);
        if (closeOnSelection) {
          close();
        }
      } catch (error) {
        setPending(false);
        console.error('[selection-assignment] toggle failed', error);
      }
    },
    [onToggle, close, closeOnSelection],
  );

  const handleCreate = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault?.();
      if (!onCreate) {
        return;
      }
      const value = query.trim();
      if (!value) {
        return;
      }
      setPending(true);
      try {
        await onCreate(value);
        setPending(false);
        close();
      } catch (error) {
        setPending(false);
        console.error('[selection-assignment] creation failed', error);
      }
    },
    [onCreate, query, close],
  );

  const existingLabels = useMemo(
    () => new Set(normalizedItems.map((item) => item.label.toLowerCase())),
    [normalizedItems],
  );

  const canCreate = Boolean(onCreate);
  const trimmedQuery = query.trim();
  const queryKey = trimmedQuery.toLowerCase();
  const canSubmitCreate = canCreate
    && trimmedQuery.length > 0
    && !existingLabels.has(queryKey)
    && !pending;

  const handleTriggerClick = useCallback(() => {
    if (disabled) {
      return;
    }
    if (!isOpen) {
      onOpenMenu?.();
    }
    toggle();
  }, [disabled, isOpen, onOpenMenu, toggle]);

  return (
    <div className={className ? `selection-assignment ${className}` : 'selection-assignment'}>
      <button
        type="button"
        ref={anchorRef}
        className={triggerClassName}
        onClick={handleTriggerClick}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        {triggerContent ? triggerContent : (
          <span className="quick-add__chip-label">
            {label}
          </span>
        )}
      </button>
      {isOpen ? (
        <div
          className="menu menu--floating selection-assignment__menu"
          ref={menuRef}
          style={menuStyle || undefined}
          role="menu"
          data-floating-position
        >
          <div className="selection-assignment__header">
            <form className="selection-assignment__form" onSubmit={handleCreate}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                disabled={pending}
              />
              {canCreate ? (
                <button
                  type="submit"
                  className="icon-button selection-assignment__add"
                  disabled={!canSubmitCreate}
                  aria-label={createLabel}
                  title={createLabel}
                >
                  <PlusIcon aria-hidden="true" />
                </button>
              ) : null}
            </form>
          </div>
          <div className="selection-assignment__list" role="presentation">
            {filteredItems.length ? (
              filteredItems.map((item) => {
                const isAll = item.state === 'all';
                const isPartial = item.state === 'partial';
                const icon = showStateIndicators
                  ? isAll
                    ? <CheckIcon className="selection-assignment__icon" aria-hidden="true" />
                    : isPartial
                      ? <CircleDashedCheckIcon className="selection-assignment__icon" aria-hidden="true" />
                      : <span className="selection-assignment__icon selection-assignment__icon--empty" aria-hidden="true" />
                  : null;
                const countLabel = showCounts && item.total && (isPartial || isAll)
                  ? `${item.count ?? 0}/${item.total}`
                  : null;
                const labelContent = renderItemLabel ? renderItemLabel(item) : item.label;
                const labelClassName = [
                  'selection-assignment__label',
                  (!showStateIndicators || !icon) ? 'selection-assignment__label--nowrap' : null,
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`menu__item selection-assignment__item selection-assignment__item--${item.state}`}
                    onClick={() => handleToggle(item)}
                    disabled={pending}
                    role="menuitem"
                  >
                    {icon}
                    <span className={labelClassName}>
                      {labelContent}
                    </span>
                    {countLabel ? (
                      <span className="selection-assignment__count">{countLabel}</span>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="menu__empty selection-assignment__empty">{emptyMessage}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SelectionAssignmentMenu;
