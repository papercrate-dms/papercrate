import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import UnifiedDocumentViewer from '../UnifiedDocumentViewer';
import DocumentDownloadLink from '../../documents/components/DocumentDownloadLink';
import PanelHeader from '../../components/PanelHeader';
import { IconX, FileInfoIcon } from '../../components/icons';

import type { Document } from '../../types/documents';

interface FullscreenPreviewOverlayProps {
  open?: boolean;
  onClose: () => void;
  onMaximize?: () => void;
  document?: Document | null;
}

const FullscreenPreviewOverlay: React.FC<FullscreenPreviewOverlayProps> = ({
  open = false,
  onClose,
  onMaximize,
  document: inputDocument = null,
}) => {
  const [renderBackdrop, setRenderBackdrop] = useState(false);
  const [isBackdropVisible, setBackdropVisible] = useState(false);
  const lastDocumentRef = useRef<Document | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);

  if (inputDocument) {
    lastDocumentRef.current = inputDocument;
  }

  const documentTitle = lastDocumentRef.current?.title || undefined;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }

    if (open) {
      setRenderBackdrop(true);
      timerRef.current = requestAnimationFrame(() => {
        timerRef.current = requestAnimationFrame(() => {
          setBackdropVisible(true);
          scrollRef.current?.focus?.({ preventScroll: true });
          timerRef.current = null;
        });
      });
    } else {
      setBackdropVisible(false);
      timerRef.current = window.setTimeout(() => {
        setRenderBackdrop(false);
        timerRef.current = null;
      }, 300);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        cancelAnimationFrame(timerRef.current);
      }
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (!open) {
      return;
    }

    const key = event.key;

    if (key === ' ' || key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
  };

  const stageClassName = 'fullscreen-preview__stage';
  const containerClassName = 'fullscreen-preview__scroll';

  const backdropClassName = [
    'fullscreen-preview-backdrop',
    isBackdropVisible ? 'fullscreen-preview-backdrop--visible' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!renderBackdrop) {
    return null;
  }

  return createPortal(
    (
      <div
        className={backdropClassName}
        role="dialog"
        aria-modal="true"
        aria-label="Enlarged document preview"
        onClick={onClose}
        onKeyDown={handleKeyDown}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <PanelHeader
            className="panel-header--dark"
            title={documentTitle}
            leading={
              <>
                <button
                  onClick={onClose}
                  className="icon-button"
                  aria-label="Close preview"
                  type="button"
                >
                  <IconX />
                </button>
                {onMaximize && (
                  <button
                    onClick={onMaximize}
                    className="icon-button"
                    aria-label="Open document info"
                    title="Open document info"
                    type="button"
                  >
                    <FileInfoIcon />
                  </button>
                )}
              </>
            }
            actions={
              <>
                <DocumentDownloadLink document={lastDocumentRef.current} />
              </>
            }
          />
        </div>
        <div
          className={stageClassName}
          ref={stageRef}
        >
          <div
            className={containerClassName}
            ref={scrollRef}
            tabIndex={-1}
          >
            <UnifiedDocumentViewer
              document={lastDocumentRef.current}
              viewportRef={scrollRef}
            />
          </div>
        </div>
      </div>
    ),
    document.body,
  );
};

export default FullscreenPreviewOverlay;
