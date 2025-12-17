import React from 'react';
import type { DocumentViewLogic } from '../logic/useDocumentViewLogic';
import { useDocumentItemLogic } from '../logic/useDocumentItemLogic';
import EntryShell from './EntryShell';
import type { TagInteractionHandlers } from '../interactions/useTagInteractions';

interface DocumentEntryProps {
    doc: any;
    tagHandlers?: TagInteractionHandlers;
    viewLogic: DocumentViewLogic;
    component: React.ElementType;
    className?: string;
    role?: string;
    children: (logic: ReturnType<typeof useDocumentItemLogic>) => React.ReactNode;
}

const DocumentEntry: React.FC<DocumentEntryProps> = (props) => {
    const { doc, tagHandlers, component, className, role, children, viewLogic } = props;
    const logic = useDocumentItemLogic({ doc, tagHandlers, viewLogic });

    return (
        <EntryShell
            component={component}
            id={`document-${doc.id}`}
            docId={doc.id}
            handlers={logic.handlers}
            isSelected={logic.isSelected}
            isDragging={logic.isDraggingDoc}
            canDrag={true}
            className={className}
            role={role}
        >
            {children(logic)}
        </EntryShell>
    );
};

export default DocumentEntry;
