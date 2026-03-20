import React from 'react';
import { CheckIcon, CloseIcon } from '../../components/icons';

interface InlineRenameInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onSubmit' | 'value'> {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: (event?: React.SyntheticEvent) => void;
    isSaving?: boolean;
    canSubmit?: boolean;
    inputRef?: React.Ref<HTMLInputElement>;
    className?: string;
}

const InlineRenameInput: React.FC<InlineRenameInputProps> = ({
    value,
    onChange,
    onSubmit,
    onCancel,
    isSaving = false,
    canSubmit = true,
    inputRef,
    className = 'doc-title-edit',
    type = 'text',
    ...props
}) => {
    return (
        <span className={className}>
            <input
                type={type}
                ref={inputRef}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        onSubmit();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancel(event);
                    }
                }}
                onBlur={(event) => {
                    if (type === 'date') return;
                    const nextFocus = event.relatedTarget;
                    if (!nextFocus || !event.currentTarget.parentElement?.contains(nextFocus)) {
                        onCancel();
                    }
                }}
                {...props}
            />
            <button
                type="button"
                className="icon-button"
                aria-label="Save"
                title="Save"
                disabled={!canSubmit || isSaving}
                onClick={(event) => {
                    event.stopPropagation();
                    onSubmit();
                }}
            >
                <CheckIcon />
            </button>
            <button
                type="button"
                className="icon-button"
                aria-label="Cancel"
                title="Cancel"
                onClick={(event) => {
                    onCancel(event);
                }}
            >
                <CloseIcon />
            </button>
        </span>
    );
};

export default InlineRenameInput;
