import React, { useCallback } from 'react';
import type { Document } from '../../types/documents';
import type { Identifier } from '../../types/identifiers';
import { createSafeContext } from '../../utils/createSafeContext';
import { PANEL_LIMITS } from '../../constants/layout';

type DocumentOpenIntent = 'preview' | 'inspect' | 'navigate';

interface DocumentOpenContextValue {
    openDocument: (doc: Document, intent?: DocumentOpenIntent) => void;
}

const [DocumentOpenContext, useDocumentOpen] = createSafeContext<DocumentOpenContextValue>('DocumentOpen');

interface DocumentOpenProviderProps {
    children: React.ReactNode;
    onOpenViewer?: (docId: Identifier) => void;
    onOpenFullscreenPreview?: (doc: Document) => void;
    onOpenDetailPanel?: (docId: Identifier) => void;
}

export const DocumentOpenProvider: React.FC<DocumentOpenProviderProps> = ({
    children,
    onOpenViewer,
    onOpenFullscreenPreview,
    onOpenDetailPanel,
}) => {
    const openDocument = useCallback((doc: Document, intent: DocumentOpenIntent = 'preview') => {
        if (!doc) return;

        switch (intent) {
            case 'preview':
                if (onOpenFullscreenPreview) {
                    onOpenFullscreenPreview(doc);
                }
                break;
            case 'inspect':
                // Responsive behavior: on mobile, "inspect" just navigates to the document
                if (window.matchMedia(`(max-width: ${PANEL_LIMITS.sidebar.minPx * 2}px)`).matches) {
                    if (onOpenViewer) {
                        onOpenViewer(doc.id);
                    }
                } else {
                    if (onOpenDetailPanel) {
                        onOpenDetailPanel(doc.id);
                    }
                }
                break;
            case 'navigate':
                if (onOpenViewer) {
                    onOpenViewer(doc.id);
                }
                break;
        }
    }, [onOpenFullscreenPreview, onOpenDetailPanel, onOpenViewer]);

    return (
        <DocumentOpenContext.Provider value={{ openDocument }}>
            {children}
        </DocumentOpenContext.Provider>
    );
};

export { useDocumentOpen };
