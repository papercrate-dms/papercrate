import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CloseIcon,
  IconZoomInArea,
  WindowMaximizeIcon,
} from '../components/icons';
import DocumentDownloadLink from '../documents/components/DocumentDownloadLink';
import { useFullscreenPreviewContext } from './FullscreenPreviewContext';
import { extractDocumentMetadataPayload } from './logic/documentSummary';
import { resolveDocumentAssetUrl } from '../lib/assets/AssetManager';
import PanelHeader from '../components/PanelHeader';
import BreadcrumbTrail from '../components/BreadcrumbTrail';
import DocumentViewerLayout from './DocumentViewerLayout';
import { useViewerLayoutMode } from './useViewerLayoutMode';
import { usePanelResizeBindings } from '../app/PanelManagerContext';
import type { DocumentId, FolderId } from '../types/identifiers';
import type { Document } from '../types/documents';
import type { Asset } from '../types/assets';

type SidebarMode = 'overlay' | 'inline';

interface DocumentViewerPanelProps {
  document: Document | null;

  // Summary section action callbacks (document-specific)
  tagOptions?: any[];
  onTagAdd?: (...args: unknown[]) => void;
  onTagRemove?: (...args: unknown[]) => void;
  correspondentOptions?: any[];
  onCorrespondentAdd?: (...args: unknown[]) => void;
  onCorrespondentRemove?: (...args: unknown[]) => void;
  onUpdateTitle?: (...args: unknown[]) => unknown;
  onUpdateIssued?: (...args: unknown[]) => unknown;

  ensureAssetUrl?: (documentId: DocumentId, asset: Asset, options?: { force?: boolean }) => Promise<unknown>;
  getDocumentAsset?: (doc: Document | null, type: string) => Asset | null;
  ensurePreviewData?: (docId: DocumentId, options?: { signal?: AbortSignal }) => Promise<Document | null>;
  notifyApiError?: (error: unknown, fallbackMessage?: string) => void;
  sidebarToggle?: ReactNode;
  onClose?: () => void;
  resolveFolderPath?: (doc: Document | null) => Array<{ id?: string; name?: string }>;
  variant?: 'viewer' | 'sidebar';
  onMaximize?: (args: { documentIds: Array<string> }) => void;
  sidebarMode?: SidebarMode;
}

const createDocumentViewerHeaderActions = ({
  document,
}) => {
  if (!document) {
    return null;
  }

  return (
    <>
      <DocumentDownloadLink document={document} />
    </>
  );
};

const DocumentViewerPanel: React.FC<DocumentViewerPanelProps> = ({
  document,
  tagOptions,
  onTagAdd,
  onTagRemove,
  correspondentOptions,
  onCorrespondentAdd,
  onCorrespondentRemove,
  onUpdateTitle,
  onUpdateIssued,
  ensureAssetUrl,
  getDocumentAsset,
  ensurePreviewData,
  sidebarToggle = null,
  onClose,
  resolveFolderPath,
  variant = 'viewer',
  onMaximize,
  sidebarMode = 'overlay',
}) => {
  const navigate = useNavigate();
  const isSidebarVariant = variant === 'sidebar';
  const [tabNav, setTabNav] = useState<ReactNode>(null);
  const metadataPayload = useMemo(
    () => extractDocumentMetadataPayload(document),
    [document],
  );

  const hasOcr = useMemo(() => {
    if (!document || !getDocumentAsset) {
      return false;
    }
    return Boolean(getDocumentAsset(document, 'text-content'));
  }, [document, getDocumentAsset]);

  useEffect(() => {
    if (!document?.id || !ensurePreviewData) {
      return;
    }
    const download = document.current_version?.download;
    if (download?.expires_at && download.expires_at <= Date.now()) {
      ensurePreviewData(document.id).catch((error) => {
        console.warn('Failed to refresh expired document', error);
      });
    }
  }, [document, ensurePreviewData]);

  const navigateToFolder = useCallback(
    (folderId: FolderId | null) => {
      const target = folderId == null
        ? '/folders'
        : `/folders/${folderId}`;
      navigate(target);
    },
    [navigate],
  );

  const summaryProps = useMemo(
    () => ({
      tagOptions,
      onTagAdd,
      onTagRemove,
      correspondentOptions,
      onCorrespondentAdd,
      onCorrespondentRemove,
      onUpdateTitle,
      onUpdateIssued,
      onFolderNavigate: navigateToFolder,
    }),
    [
      tagOptions,
      onTagAdd,
      onTagRemove,
      correspondentOptions,
      onCorrespondentAdd,
      onCorrespondentRemove,
      onUpdateTitle,
      onUpdateIssued,
      navigateToFolder,
    ],
  );

  const infoPanelProps = useMemo(() => ({}), []);

  const loadOcrContent = useCallback(async ({ signal }: { signal?: AbortSignal } = {}) => {
    if (!document || !hasOcr || !getDocumentAsset) {
      return '';
    }

    const updateUrl = () =>
      resolveDocumentAssetUrl(document, 'text-content', {
        ensureAssetUrl,
        getAsset: getDocumentAsset,
      });

    const asset = getDocumentAsset(document, 'text-content');
    let url = updateUrl();

    if (!url && document.id && asset?.id && ensureAssetUrl) {
      await ensureAssetUrl(document.id, asset, { force: true });
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      url = updateUrl();
    }

    if (!url) {
      return '';
    }

    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal,
    });

    if (!response.ok) {
      throw new Error(`Unexpected status: ${response.status}`);
    }

    return response.text();
  }, [document, hasOcr, getDocumentAsset, ensureAssetUrl]);

  const contentTabConfig = useMemo(
    () => ({
      enabled: hasOcr,
      id: 'content',
      label: 'Content',
      loadContent: loadOcrContent,
      loadingMessage: 'Loading text content…',
      emptyMessage: 'No text content available.',
      unavailableMessage: 'No text content available.',
      errorMessage: 'Failed to load text content.',
    }),
    [hasOcr, loadOcrContent],
  );

  const { openFullscreenPreview } = useFullscreenPreviewContext();

  const handleZoomOpen = useCallback(() => {
    if (!document) {
      return;
    }
    openFullscreenPreview(document);
  }, [document, openFullscreenPreview]);

  const panelRef = useRef<HTMLDivElement | HTMLFormElement | HTMLElement | null>(null);
  const isStackedLayout = useViewerLayoutMode(panelRef, document?.id);

  const {
    panelStyle: managedDetailPanelStyle,
    handleProps: managedResizeHandleProps,
    isPanelResizing,
  } = usePanelResizeBindings('detail', { enabled: isSidebarVariant, panelRef });
  const detailPanelStyle = isSidebarVariant ? managedDetailPanelStyle : undefined;
  const resizeHandleProps = isSidebarVariant ? managedResizeHandleProps : {};

  const viewerClassName = isStackedLayout
    ? 'document-viewer document-viewer--stacked'
    : 'document-viewer';

  const breadcrumbs = useMemo(() => {
    if (!document || !resolveFolderPath) {
      return [];
    }
    const folderSegments = resolveFolderPath(document.folder_id);
    const normalizedSegments = Array.isArray(folderSegments)
      ? folderSegments
        .filter((segment) => segment && segment.id && segment.name)
        .map((segment) => ({ id: segment.id, name: segment.name }))
      : [];

    return [
      ...normalizedSegments,
      { id: document.id, name: document.title },
    ];
  }, [document, resolveFolderPath]);

  const breadcrumbTrailEntries = useMemo(() => {
    if (!breadcrumbs.length) {
      return [];
    }
    const lastIndex = breadcrumbs.length - 1;
    return breadcrumbs.map((crumb, index) => ({
      id: crumb.id,
      label: crumb.name,
      onClick: index < lastIndex ? () => navigateToFolder(crumb.id) : null,
    }));
  }, [breadcrumbs, navigateToFolder]);

  const downloadAction = createDocumentViewerHeaderActions({ document });
  const headerActions = (
    <>
      {tabNav && <><span className="actions-divider" aria-hidden="true" />{tabNav}<span className="actions-divider" aria-hidden="true" /></>}
      {downloadAction}
    </>
  );

  const maximizeButton = isSidebarVariant && onMaximize
    ? (
      <button
        type="button"
        className="icon-button"
        onClick={(event) => {
          event.stopPropagation();
          const targetId = document?.id;
          if (targetId == null) {
            return;
          }
          onMaximize?.({ documentIds: [targetId] });
        }}
        aria-label="Maximize"
        title="Maximize"
      >
        <WindowMaximizeIcon className="icon--flip-y" />
      </button>
    )
    : null;

  const closeButton = onClose
    ? (
      <button
        type="button"
        className="icon-button"
        onClick={() => onClose?.()}
        aria-label="Close preview"
        title="Close preview"
      >
        <CloseIcon />
      </button>
    )
    : null;

  const previewZoomButton = (
    <button
      type="button"
      className="icon-button"
      onClick={handleZoomOpen}
      aria-label="Open zoom preview"
      title="Open zoom preview"
    >
      <IconZoomInArea />
    </button>
  );

  const headerLeadingButtons = [
    sidebarToggle ? <React.Fragment key="sidebar-toggle">{sidebarToggle}</React.Fragment> : null,
    closeButton ? <React.Fragment key="close-button">{closeButton}</React.Fragment> : null,
    maximizeButton ? <React.Fragment key="maximize-button">{maximizeButton}</React.Fragment> : null,
    previewZoomButton ? <React.Fragment key="preview-zoom-button">{previewZoomButton}</React.Fragment> : null,
  ].filter(Boolean);
  const headerLeadingContent = headerLeadingButtons.length ? headerLeadingButtons : null;

  const resizeHandle = isSidebarVariant ? (
    <button
      type="button"
      className={`resize-handle resize-handle--left${isPanelResizing ? ' is-active' : ''}`}
      aria-label="Resize detail panel"
      {...resizeHandleProps}
    >
      <span className="resize-handle__line" aria-hidden="true" />
    </button>
  ) : null;

  const loadingSection = (
    <div className="document-viewer-panel__body">
      <section className="document-viewer document-viewer--loading">
        <div className="document-viewer__details-pane">
          <div className="document-viewer__details">
            <div className="document-viewer__message">Loading document…</div>
          </div>
        </div>
        <div className="document-viewer__viewport">
          <div className="document-viewer__message">Preparing preview…</div>
        </div>
      </section>
    </div>
  );

  const viewerSection = document ? (
    <div
      className={isStackedLayout
        ? 'document-viewer-panel__body document-viewer-panel__body--stacked'
        : 'document-viewer-panel__body'}
    >
      <section className={viewerClassName}>
        <DocumentViewerLayout
          document={document}
          summaryProps={summaryProps}
          infoPanelProps={infoPanelProps}
          metadataPayload={metadataPayload}
          contentTabConfig={contentTabConfig}
          previewLoadingMessage="Loading preview…"
          layoutMode={isStackedLayout ? 'stacked' : 'split'}
          onTabNavChange={setTabNav}
        />
      </section>
    </div>
  ) : loadingSection;

  const headerTitle = breadcrumbTrailEntries.length ? (
    <div className="panel-header__breadcrumbs-wrapper">
      <BreadcrumbTrail
        entries={breadcrumbTrailEntries}
        separator="/"
        className="panel-header__breadcrumbs"
        truncateFromStart={isSidebarVariant}
      />
    </div>
  ) : (
    document?.title || 'Document preview'
  );

  if (isSidebarVariant) {
    const sidebarClass = `detail-panel panel${sidebarMode === 'inline' ? ' detail-panel--inline' : ''}${isPanelResizing ? ' detail-panel--resizing' : ''}`;
    return (
      <>
        <aside
          className={sidebarClass}
          ref={panelRef}
          style={detailPanelStyle}
        >
          {resizeHandle}
          <PanelHeader
            leading={headerLeadingContent}
            title={headerTitle}
            titleTag="h3"
            actions={headerActions}
          />
          <div className="panel-body detail-panel__content">{viewerSection}</div>
        </aside>
      </>
    );
  }

  return (
    <>
      <section className="document-viewer-panel" ref={panelRef}>
        <PanelHeader
          leading={headerLeadingContent}
          title={headerTitle}
          titleTag="h3"
          actions={headerActions}
        />
        {viewerSection}
      </section>
    </>
  );
};

export default DocumentViewerPanel;
