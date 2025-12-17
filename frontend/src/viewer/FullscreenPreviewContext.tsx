import React, { useState, useCallback, useMemo, useRef } from 'react';
import FullscreenPreviewOverlay from './components/FullscreenPreviewOverlay';
import type { Document } from '../types/documents';
import type { Identifier } from '../types/identifiers';
import { createSafeContext } from '../utils/createSafeContext';

interface FullscreenPreviewContextType {
    openFullscreenPreview: (doc: Document) => void;
    closeFullscreenPreview: () => void;
}

const [FullscreenPreviewContext, useFullscreenPreviewContext] = createSafeContext<FullscreenPreviewContextType>('FullscreenPreview');

interface FullscreenPreviewProviderProps {
    children: React.ReactNode;
    onNavigate?: (documentId: Identifier) => void;
}

export const FullscreenPreviewProvider: React.FC<FullscreenPreviewProviderProps> = ({ children, onNavigate }) => {
    const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
    const lastFocusedElement = useRef<HTMLElement | null>(null);

    const openFullscreenPreview = useCallback((doc: Document) => {
        if (!lastFocusedElement.current) {
            lastFocusedElement.current = document.activeElement as HTMLElement;
        }
        setPreviewDoc(doc);
    }, []);

    const closeFullscreenPreview = useCallback(() => {
        setPreviewDoc(null);
        if (lastFocusedElement.current) {
            lastFocusedElement.current.focus();
            lastFocusedElement.current = null;
        }
    }, []);

    const handleMaximize = useCallback(() => {
        if (previewDoc && onNavigate) {
            onNavigate(previewDoc.id);
            closeFullscreenPreview();
        }
    }, [previewDoc, onNavigate, closeFullscreenPreview]);

    const value = useMemo(() => ({
        openFullscreenPreview,
        closeFullscreenPreview,
    }), [openFullscreenPreview, closeFullscreenPreview]);

    return (
        <FullscreenPreviewContext.Provider value={value}>
            {children}
            <FullscreenPreviewOverlay
                open={Boolean(previewDoc)}
                onClose={closeFullscreenPreview}
                onMaximize={onNavigate ? handleMaximize : undefined}
                document={previewDoc}
            />
        </FullscreenPreviewContext.Provider>
    );
};

export { useFullscreenPreviewContext };
