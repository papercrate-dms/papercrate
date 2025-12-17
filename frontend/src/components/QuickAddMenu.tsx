import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, FormEvent, MutableRefObject } from 'react';
import { PlusIcon } from './icons';

import useFloatingMenu from './useFloatingMenu';

type QuickAddOption = string | { id?: string; label?: string; name?: string;[key: string]: unknown };

interface NormalizedOption {
  id?: string;
  label: string;
  original: QuickAddOption;
  index: number;
}

const normalizeOption = (option: QuickAddOption | null, index: number): NormalizedOption | null => {
  if (option == null) {
    return null;
  }
  if (typeof option === 'object') {
    const label = option.label ?? option.name;
    if (label == null) {
      return null;
    }
    return {
      id: option.id ?? label,
      label: String(label),
      original: option,
      index,
    };
  }
  const label = String(option);
  return {
    id: label,
    label,
    original: option,
    index,
  };
};

interface FloatingMenuState {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  menuRef: MutableRefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties | null;
  updatePosition: () => void;
}

type CSSVarStyle = CSSProperties & Record<string, string>;

interface QuickAddMenuProps {
  onSelectOption?: (value: QuickAddOption, normalized: NormalizedOption) => Promise<void> | void;
  onCreate?: (value: string) => Promise<void> | void;
  options?: QuickAddOption[];
  placeholder?: string;
  createLabel?: string;
  emptyMessage?: string;
  className?: string;
  triggerAriaLabel?: string;
  triggerTitle?: string;
  renderOption?: (value: QuickAddOption, normalized: NormalizedOption) => ReactNode;
  menuMinWidth?: number;
  triggerClassName?: string;
  triggerContent?: ReactNode;
  disabled?: boolean;
  align?: 'start' | 'center' | 'end' | (string & {});
  positionStrategy?: 'fixed' | 'absolute' | (string & {});
}

const QuickAddMenu = ({
  onSelectOption,
  onCreate,
  options = [],
  placeholder = 'Search or create…',
  createLabel = 'Add',
  emptyMessage = 'No matches',
  className,
  triggerAriaLabel = 'Add item',
  triggerTitle = 'Add',
  renderOption,
  menuMinWidth = 220,
  triggerClassName = 'icon-button quick-add__trigger',
  triggerContent = null,
  disabled = false,
  align = 'start',
  positionStrategy = 'fixed',
}: QuickAddMenuProps) => {
  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    isOpen,
    toggle,
    close,
    menuRef,
    menuStyle,
    updatePosition,
  } = useFloatingMenu({
    anchorRef,
    minWidth: menuMinWidth,
    matchAnchorWidth: false,
    align,
    positionStrategy,
  }) as FloatingMenuState;

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
    setSubmitting(false);

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
      updatePosition();
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen, updatePosition]);

  const normalizedOptions = useMemo<NormalizedOption[]>(
    () =>
      options
        .map((option, index) => normalizeOption(option, index))
        .filter((option): option is NormalizedOption => Boolean(option)),
    [options],
  );

  const filteredOptions = useMemo(() => {
    if (!query.trim()) {
      return normalizedOptions;
    }
    const search = query.trim().toLowerCase();
    return normalizedOptions.filter((option) => option.label.toLowerCase().includes(search));
  }, [normalizedOptions, query]);

  const handleSelect = useCallback(
    async (option: NormalizedOption) => {
      if (!option || !onSelectOption) {
        return;
      }
      setSubmitting(true);
      try {
        await onSelectOption(option.original ?? option.label, option);
        setSubmitting(false);
        close();
      } catch (error) {
        setSubmitting(false);
        console.error('[quick-add] option selection failed', error);
      }
    },
    [close, onSelectOption],
  );

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!onCreate) {
        return;
      }
      const value = query.trim();
      if (!value) {
        return;
      }
      setSubmitting(true);
      try {
        await onCreate(value);
        setSubmitting(false);
        close();
      } catch (error) {
        setSubmitting(false);
        console.error('[quick-add] creation failed', error);
      }
    },
    [close, onCreate, query],
  );

  const canCreate = Boolean(onCreate);
  const isAnchoredMenu = positionStrategy === 'absolute' && align === 'start';
  const menuClassName = 'menu menu--floating';
  const anchoredMenuStyle = isAnchoredMenu && menuStyle
    ? {
      top: menuStyle.top,
      left: menuStyle.left,
      ...(menuStyle.width ? { width: menuStyle.width } : null),
    }
    : undefined;
  const menuInlineStyle = (isAnchoredMenu ? anchoredMenuStyle : menuStyle || undefined) as CSSVarStyle | undefined;
  const hasFloatingWidthVar = Boolean(menuInlineStyle && Object.prototype.hasOwnProperty.call(menuInlineStyle, '--floating-min-width'));
  const menuStyleWithVar: CSSVarStyle | undefined = hasFloatingWidthVar
    ? menuInlineStyle
    : {
      ...(menuInlineStyle || {}),
      '--floating-min-width': `${Math.max(menuMinWidth, 0)}px`,
    };

  return (
    <div className={className ? `quick-add ${className}` : 'quick-add'}>
      <button
        type="button"
        ref={anchorRef}
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
        aria-label={triggerAriaLabel}
        title={triggerTitle}
        disabled={disabled}
      >
        {triggerContent ?? <PlusIcon />}
      </button>
      {isOpen ? (
        <div
          className={menuClassName}
          ref={menuRef}
          style={menuStyleWithVar}
          role="menu"
          data-floating-position
        >
          {canCreate ? (
            <form className="quick-add__form" onSubmit={handleCreate}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                disabled={submitting}
                aria-label={placeholder}
              />
              <button type="submit" disabled={submitting || !query.trim()}>
                {createLabel}
              </button>
            </form>
          ) : null}
          <div className="menu__list" role="presentation">
            {filteredOptions.length ? (
              filteredOptions.map((option) => {
                const key = option.id ?? option.index;
                return (
                  <button
                    key={key}
                    type="button"
                    className="menu__item"
                    role="menuitem"
                    onClick={() => handleSelect(option)}
                    disabled={submitting}
                  >
                    {renderOption ? (
                      renderOption(option.original ?? option.label, option)
                    ) : (
                      <span className="menu__label">{option.label}</span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="menu__empty">{emptyMessage}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QuickAddMenu;
