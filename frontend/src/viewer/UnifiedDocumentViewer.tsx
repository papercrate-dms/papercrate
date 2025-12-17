import React, { useMemo } from 'react';
import PdfViewer from './PdfViewer';
import MediaViewer from './MediaViewer';
import { resolveDocumentDownloadHref } from '../documents/documentActions';
import type { Document } from '../types/documents';

interface UnifiedDocumentViewerProps {
    document: Document | null;
    viewportRef?: React.RefObject<HTMLDivElement>;
}

const UnifiedDocumentViewer: React.FC<UnifiedDocumentViewerProps> = ({
    document,
    viewportRef,
}) => {
    const content = useMemo(() => {
        if (!document) {
            return null;
        }

        const downloadUrl = resolveDocumentDownloadHref(document);
        if (!downloadUrl) {
            return null;
        }

        const normalizedMimeType = (document.mime_type || '').toLowerCase();
        const normalizedFilename = document.filename;

        const isPdf = normalizedMimeType === 'application/pdf'
            || normalizedMimeType === 'application/x-pdf';

        if (isPdf) {
            return (
                <PdfViewer
                    src={downloadUrl}
                    title={document.title}
                    viewportRef={viewportRef}
                />
            );
        }

        return (
            <MediaViewer
                src={downloadUrl}
                mimeType={normalizedMimeType}
                filename={normalizedFilename}
                alt={document.title}
                onClick={(e) => e.stopPropagation()}
            />
        );
    }, [
        document,
        viewportRef,
    ]);

    return content;
};

export default UnifiedDocumentViewer;
