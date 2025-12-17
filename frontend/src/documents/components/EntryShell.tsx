import React, { type DragEvent } from 'react';

interface EntryShellHandlers {
    onClick: (event: React.MouseEvent) => void;
    onDoubleClick: (event: React.MouseEvent) => void;
    onDragStart: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
    onDragOverCapture?: (event: DragEvent<HTMLElement>) => void;
    onDragLeaveCapture?: (event: DragEvent<HTMLElement>) => void;
}

interface EntryShellProps {
    component: React.ElementType;
    handlers: EntryShellHandlers;
    isSelected?: boolean;
    isDragging?: boolean;
    canDrag?: boolean;
    id: string;
    className?: string;
    children: React.ReactNode;
    docId?: number;
    role?: string;
}

const EntryShell: React.FC<EntryShellProps> = ({
    component: Component,
    handlers,
    isSelected,
    isDragging,
    canDrag,
    id,
    className = '',
    children,
    docId,
    role,
}) => {
    const classes = [className];
    if (isSelected) classes.push('selected');
    if (isDragging) classes.push('is-dragging');

    const commonProps = {
        id,
        className: classes.join(' '),
        onClick: handlers.onClick,
        onDoubleClick: handlers.onDoubleClick,
        draggable: canDrag,
        onDragStart: handlers.onDragStart,
        onDragEnd: handlers.onDragEnd,
        onDragOver: handlers.onDragOver,
        onDragLeave: handlers.onDragLeave,
        onDrop: handlers.onDrop,
        ...(docId ? { 'data-doc-id': docId } : {}),
        ...(role ? { role } : {}),
    };

    return (
        <Component {...commonProps}>
            {children}
        </Component>
    );
};

export default EntryShell;
