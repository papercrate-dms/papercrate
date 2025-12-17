import React, { useCallback, useMemo } from 'react';
import { SORT_LABEL_LOOKUP, SORT_OPTIONS } from '../../constants/documents';
import QuickAddMenu from '../../components/QuickAddMenu';

interface SortFieldQuickMenuProps {
  sortField: string;
  onChange?: (value: string) => void;
}

const SortFieldQuickMenu: React.FC<SortFieldQuickMenuProps> = ({ sortField, onChange }) => {
  const currentOption = useMemo(
    () => SORT_OPTIONS.find((option) => option.value === sortField) || SORT_OPTIONS[0],
    [sortField],
  );

  const options = useMemo(
    () => SORT_OPTIONS.map((option) => ({ id: option.value, label: option.label })),
    [],
  );

  const handleSelect = useCallback(
    (value: string, option?: { id?: string; original?: { id?: string } }) => {
      if (!onChange) {
        return;
      }
      const nextValue = option?.id || option?.original?.id || value;
      if (nextValue) {
        onChange(nextValue);
      }
    },
    [onChange],
  );

  const label = currentOption?.label || SORT_LABEL_LOOKUP[currentOption?.value] || 'Title';

  return (
    <QuickAddMenu
      className="documents-sort__quickmenu"
      options={options}
      onSelectOption={handleSelect}
      triggerClassName="toggle-button documents-sort__trigger quick-add__trigger"
      triggerContent={(
        <span className="documents-sort__trigger-content">
          <span className="documents-sort__label">{label}</span>
        </span>
      )}
      triggerAriaLabel={`Sort by ${label}`}
      triggerTitle={`Sort by ${label}`}
      placeholder="Select sort field"
      menuMinWidth={200}
      align="start"
      positionStrategy="absolute"
    />
  );
};

export default SortFieldQuickMenu;
