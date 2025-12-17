import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { JSX } from 'react';
import { CheckIcon, ChevronDownIcon } from '../../components/icons';
import type { CapabilityValue } from '../../types/identifiers';

export interface CapabilityDropdownOption {
  value?: CapabilityValue | null;
  id?: CapabilityValue | null;
  label?: string;
}

interface CapabilityDropdownProps {
  id?: string;
  options?: Array<CapabilityDropdownOption | CapabilityValue>;
  selectedValues?: CapabilityValue[];
  onSelect?: (value: CapabilityValue) => void;
  onDeselect?: (value: CapabilityValue) => void;
  formatLabel?: (value: CapabilityValue) => string;
  disabled?: boolean;
  loading?: boolean;
  summaryLabel?: string;
}



const resolveCapabilityValue = (
  option: CapabilityDropdownOption | CapabilityValue | null,
): CapabilityValue | null => {
  if (option == null) {
    return null;
  }
  if (typeof option !== 'object') {
    return option;
  }
  if (option.value != null) {
    return option.value;
  }
  if (option.id != null) {
    return option.id;
  }
  return null;
};

const CapabilityDropdown = ({
  id,
  options = [],
  selectedValues = [],
  onSelect,
  onDeselect,
  formatLabel,
  disabled = false,
  loading = false,
  summaryLabel = 'capabilities',
}: CapabilityDropdownProps): JSX.Element => {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    if (disabled) {
      return;
    }
    setIsOpen((previous) => !previous);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerEvent = (event: MouseEvent | TouchEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) {
        return;
      }
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', handlePointerEvent);
    document.addEventListener('touchstart', handlePointerEvent, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerEvent);
      document.removeEventListener('touchstart', handlePointerEvent);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, isOpen]);

  const handleOptionClick = useCallback((value: CapabilityValue) => {
    if (selectedValues.includes(value)) {
      onDeselect?.(value);
    } else {
      onSelect?.(value);
    }
  }, [onDeselect, onSelect, selectedValues]);

  const derivedOptions = useMemo(() => options.filter(Boolean), [options]);
  const total = derivedOptions.length;
  const selectedCount = selectedValues.length;

  const summaryText = useMemo(() => {
    if (total) {
      return `${selectedCount}/${total} ${summaryLabel} enabled`;
    }
    if (selectedCount) {
      return `${selectedCount} ${summaryLabel} selected`;
    }
    if (loading) {
      return `Loading ${summaryLabel}…`;
    }
    return `No ${summaryLabel}`;
  }, [loading, selectedCount, summaryLabel, total]);

  const buttonText = total || selectedCount || loading ? summaryText : `Select ${summaryLabel}`;
  const emptyMessage = loading ? `Loading ${summaryLabel}…` : `No ${summaryLabel} available.`;
  const isDisabled = disabled || (total === 0 && !selectedCount) || loading;
  const menuId = id ? `${id}-menu` : undefined;

  return (
    <div className="capability-dropdown">
      <button
        type="button"
        className="capability-dropdown__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={toggle}
        disabled={isDisabled}
        ref={anchorRef}
      >
        <span>{buttonText}</span>
        <ChevronDownIcon className="capability-dropdown__chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          id={menuId}
          role="menu"
          ref={menuRef}
          className="menu menu--floating capability-dropdown__menu"
          data-floating-position
        >
          {total ? (
            derivedOptions.map((option) => {
              const value = resolveCapabilityValue(option);
              if (value == null) {
                return null;
              }
              const label = formatLabel
                ? formatLabel(value)
                : (typeof option === 'object' && option?.label) || String(value);
              const selected = selectedValues.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={selected}
                  className={`menu__item capability-dropdown__option${selected ? ' is-selected' : ''}`}
                  onClick={() => handleOptionClick(value)}
                >
                  <span className="capability-dropdown__option-icon">
                    {selected ? <CheckIcon className="icon-inline" aria-hidden="true" /> : null}
                  </span>
                  <span className="capability-dropdown__option-label">{label}</span>
                </button>
              );
            })
          ) : (
            <div className="capability-dropdown__empty">{emptyMessage}</div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default CapabilityDropdown;
