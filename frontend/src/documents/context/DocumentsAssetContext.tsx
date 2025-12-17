import { createContext, useContext } from 'react';

interface DocumentsAssetContextValue {
    ensureAssetUrl?: (...args: any[]) => unknown;
    getDocumentAsset?: (...args: any[]) => unknown;
}

export const DocumentsAssetContext = createContext<DocumentsAssetContextValue>({});

export const useDocumentsAssetContext = () => useContext(DocumentsAssetContext);
