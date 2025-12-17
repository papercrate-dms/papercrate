import React from 'react';
import InlineRenameInput from './InlineRenameInput';

interface EditableEntryTitleProps {
    isEditing: boolean;
    draftValue: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: (event?: React.SyntheticEvent) => void;
    isSaving: boolean;
    canSubmit: boolean;
    inputRef: (ref: HTMLInputElement | null) => void;
    allowInlineEdit: boolean | undefined;
    onBeginEditing: (event: React.SyntheticEvent) => void;
    children: React.ReactNode;
    className?: string;
}

const EditableEntryTitle: React.FC<EditableEntryTitleProps> = ({
    isEditing,
    draftValue,
    onChange,
    onSubmit,
    onCancel,
    isSaving,
    canSubmit,
    inputRef,
    allowInlineEdit,
    onBeginEditing,
    children,
    className,
}) => {
    if (isEditing) {
        return (
            <div className={`doc-title-edit ${className || ''}`}>
                <InlineRenameInput
                    value={draftValue}
                    onChange={onChange}
                    onSubmit={onSubmit}
                    onCancel={onCancel}
                    isSaving={isSaving}
                    canSubmit={canSubmit}
                    inputRef={inputRef}
                />
            </div>
        );
    }

    return (
        <span
            className={className}
            role={allowInlineEdit ? 'button' : undefined}
            tabIndex={allowInlineEdit ? 0 : undefined}
            onClick={onBeginEditing}
            onKeyDown={(event) => {
                if (!allowInlineEdit) return;
                if (event.key === 'Enter') {
                    onBeginEditing(event);
                }
            }}
        >
            {children}
        </span>
    );
};

export default EditableEntryTitle;
