import React from 'react';
import { DownloadIcon } from '../../components/icons';
import { resolveDocumentDownloadHref } from '../documentActions';
import type { Document } from '../../types/documents';

interface DocumentDownloadLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    document?: Document | null;
    children?: React.ReactNode;
}

const DocumentDownloadLink: React.FC<DocumentDownloadLinkProps> = ({
    document,
    children,
    className = 'icon-button',
    title = 'Download document',
    'aria-label': ariaLabel = 'Download document',
    ...rest
}) => {
    const downloadUrl = resolveDocumentDownloadHref(document);

    if (!downloadUrl) {
        return null;
    }

    return (
        <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            title={title}
            aria-label={ariaLabel}
            {...rest}
        >
            {children || <DownloadIcon />}
        </a>
    );
};

export default DocumentDownloadLink;
