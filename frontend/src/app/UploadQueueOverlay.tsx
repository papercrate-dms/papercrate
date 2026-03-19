import { useMemo, useState, useEffect } from 'react';
import type { JSX } from 'react';
import {
  CloseIcon,
  LoaderIcon,
  CheckIcon,
  InfoIcon,
  WarningIcon,
  BottombarCollapseIcon,
  BottombarExpandIcon,
} from '../components/icons';
import PanelHeader from '../components/PanelHeader';

type UploadStatus = 'pending' | 'uploading' | 'success' | 'duplicate' | 'error' | (string & {});

interface UploadQueueItem {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string | null;
  document?: { id?: string; title?: string };
  conflictDocumentId?: string;
}

interface UploadQueueOverlayProps {
  queue?: UploadQueueItem[];
  onClearQueue?: () => void;
  onDocumentClick?: (documentId: string) => void;
}

const STATUS_META: Record<string, { label: string; tone: string; icon: JSX.Element }> = {
  pending: {
    label: 'Queued',
    tone: 'muted',
    icon: <LoaderIcon className="icon icon--spin" size={16} />,
  },
  uploading: {
    label: 'Uploading',
    tone: 'accent',
    icon: <LoaderIcon className="icon icon--spin" size={16} />,
  },
  success: {
    label: 'Uploaded',
    tone: 'success',
    icon: <CheckIcon size={16} />,
  },
  duplicate: {
    label: 'Duplicate',
    tone: 'info',
    icon: <InfoIcon size={16} />,
  },
  error: {
    label: 'Failed',
    tone: 'danger',
    icon: <WarningIcon size={16} />,
  },
};

const UploadQueueOverlay = ({ queue = [], onClearQueue, onDocumentClick }: UploadQueueOverlayProps): JSX.Element | null => {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (queue.length > 0) {
      setDismissed(false);
    }
  }, [queue.length]);

  const summary = useMemo(() => {
    if (!queue.length) {
      return 'No uploads';
    }
    const uploadingCount = queue.filter((item) => item.status === 'uploading').length;
    const pendingCount = queue.filter((item) => item.status === 'pending').length;
    const errorCount = queue.filter((item) => item.status === 'error').length;
    if (uploadingCount > 0 || pendingCount > 0) {
      return `${uploadingCount} uploading · ${pendingCount} queued`;
    }
    if (errorCount > 0) {
      return `${errorCount} failed · ${queue.length} total`;
    }
    return `${queue.length} completed`;
  }, [queue]);

  const hasActiveUploads = queue.some((item) => item.status === 'uploading' || item.status === 'pending');

  const handleDismissOverlay = () => {
    if (!queue.length) {
      setDismissed(true);
      return;
    }

    if (hasActiveUploads) {
      const confirmed = window.confirm('Uploads are still running. Clear the queue and hide the overlay?');
      if (!confirmed) {
        return;
      }
    }

    onClearQueue?.();
    setDismissed(true);
  };

  if (!queue.length || dismissed) {
    return null;
  }

  return (
    <div className={`upload-queue-overlay${collapsed ? ' upload-queue-overlay--collapsed' : ''}`}>
      <PanelHeader
        title={(
          <span>
            <span>Uploads</span>
            <span className="panel-header__subtitle">{summary}</span>
          </span>
        )}
        actions={(
          <div className="upload-queue-overlay__controls">
            <button
              type="button"
              className="icon-button ghost"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand upload queue' : 'Collapse upload queue'}
            >
              {collapsed ? <BottombarExpandIcon size={16} /> : <BottombarCollapseIcon size={16} />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={handleDismissOverlay}
              aria-label="Clear uploads and hide overlay"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )}
      />
      {!collapsed ? (
        <div className="upload-queue-overlay__body">
          <ul className="upload-queue-overlay__list">
            {[...queue]
              .slice()
              .reverse()
              .map((item) => {
                const meta = STATUS_META[item.status] || STATUS_META.pending;
                const fileLabel = item.name;
                const documentTitle = item.document?.title || null;
                const duplicateLabel = item.status === 'duplicate' ? documentTitle : null;
                const documentId = item.document?.id || item.conflictDocumentId || null;
                const hasLink = Boolean(documentId);
                const handleNavigate = () => {
                  if (!documentId) {
                    return;
                  }
                  onDocumentClick?.(documentId);
                };
                return (
                  <li key={item.id} className={`upload-queue-overlay__item upload-queue-overlay__item--${item.status}`}>
                    <span className={`upload-queue-overlay__status upload-queue-overlay__status--${meta.tone}`}>
                      {meta.icon}
                    </span>
                    <div className="upload-queue-overlay__details">
                      {item.status === 'success' && hasLink ? (
                        <button
                          type="button"
                          className="upload-queue-overlay__name-link"
                          onClick={handleNavigate}
                        >
                          {fileLabel}
                        </button>
                      ) : (
                        <div className="upload-queue-overlay__name">
                          {fileLabel}
                        </div>
                      )}
                      <div className="upload-queue-overlay__meta-line">
                        {item.status === 'duplicate' && duplicateLabel ? (
                          <span className="upload-queue-overlay__meta-duplicate">
                            Duplicate of{' '}
                            <button
                              type="button"
                              className="upload-queue-overlay__meta-link"
                              onClick={handleNavigate}
                            >
                              {duplicateLabel}
                            </button>
                          </span>
                        ) : item.status === 'error' && item.error ? (
                          <span className="upload-queue-overlay__meta-error" title={item.error}>
                            {item.error}
                          </span>
                        ) : (
                          <span>{meta.label}</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default UploadQueueOverlay;
