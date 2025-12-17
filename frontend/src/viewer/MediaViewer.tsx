import React from 'react';
import { DownloadIcon } from '../components/icons';
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '../constants/preview';

interface MediaViewerProps {
    src: string;
    mimeType?: string;
    filename?: string;
    alt?: string;
    className?: string;
    style?: React.CSSProperties;
    onLoad?: (event: React.SyntheticEvent<HTMLElement>) => void;
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
    mediaRef?: React.Ref<any>;
    draggable?: boolean;
}

const getFileExtension = (filename?: string | null) => {
    if (!filename) {
        return '';
    }
    const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
};

const MediaViewer: React.FC<MediaViewerProps> = ({
    src,
    mimeType = '',
    filename = '',
    alt = 'Media preview',
    className,
    style,
    onLoad,
    onClick,
    mediaRef,
    draggable = false,
}) => {
    const normalizedMimeType = mimeType.toLowerCase();
    const fileExtension = getFileExtension(filename);

    const isImage = normalizedMimeType.startsWith('image/');
    const isAudio = normalizedMimeType.startsWith('audio/') || AUDIO_EXTENSIONS.has(fileExtension);
    const isVideo = normalizedMimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(fileExtension);

    const viewerClasses = ['document-viewer__object', className].filter(Boolean).join(' ');

    if (isImage) {
        return (
            <img
                ref={mediaRef}
                src={src}
                alt={alt}
                className={`${viewerClasses} document-viewer__object--image`}
                style={style}
                onLoad={onLoad}
                onClick={onClick}
                draggable={draggable}
            />
        );
    }

    if (isAudio) {
        return (
            <audio
                ref={mediaRef}
                className={`${viewerClasses} document-viewer__object--audio`}
                controls
                preload="metadata"
                src={src}
                aria-label={`Audio preview of ${alt}`}
                style={style}
                onLoadedMetadata={onLoad}
                onClick={onClick}
            />
        );
    }

    if (isVideo) {
        return (
            <video
                ref={mediaRef}
                className={`${viewerClasses} document-viewer__object--video`}
                controls
                preload="metadata"
                src={src}
                aria-label={`Video preview of ${alt}`}
                style={style}
                onLoadedMetadata={onLoad}
                onClick={onClick}
            />
        );
    }

    const displayMimeType = mimeType || 'this file type';
    const displayFilename = filename || 'download';

    return (
        <div className="document-viewer__unsupported" style={style}>
            <div className="document-viewer__unsupported-message">
                Preview is not available for {displayMimeType} files.
            </div>
            <div className="document-viewer__unsupported-filename">{displayFilename}</div>
            <a
                className="button-link document-viewer__unsupported-download"
                href={src}
                download={displayFilename}
                target="_blank"
                rel="noopener noreferrer"
            >
                <DownloadIcon />
                <span>Download</span>
            </a>
        </div>
    );
};

export default MediaViewer;
