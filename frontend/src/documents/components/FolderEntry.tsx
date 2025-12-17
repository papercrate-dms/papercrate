import React from 'react';
import type { DocumentViewLogic } from '../logic/useDocumentViewLogic';
import { useFolderItemLogic } from '../features/folders/useFolderItemLogic';
import EntryShell from './EntryShell';

interface FolderEntryProps {
    folder: any;
    viewLogic: DocumentViewLogic;
    component: React.ElementType;
    className?: string;
    role?: string;
    children: (logic: ReturnType<typeof useFolderItemLogic>) => React.ReactNode;
}

const FolderEntry: React.FC<FolderEntryProps> = (props) => {
    const { folder, component, className, role, children, viewLogic } = props;
    const logic = useFolderItemLogic({ folder, viewLogic });

    return (
        <EntryShell
            component={component}
            id={`folder-${folder.id}`}
            handlers={logic.handlers}
            isSelected={logic.isSelectedFolder}
            isDragging={logic.isDraggingFolder}
            canDrag={logic.canDragFolder}
            className={className}
            role={role}
        >
            {children(logic)}
        </EntryShell>
    );
};

export default FolderEntry;
