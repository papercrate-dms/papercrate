import React, { useCallback, useMemo, useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import DocumentInfoPanel from './components/DocumentInfoPanel';
import UnifiedDocumentViewer from './UnifiedDocumentViewer';
import { resolveDocumentDownloadHref } from '../documents/documentActions';
import { EyeIcon } from '../components/icons';

import type { Document } from '../types/documents';

interface ContentTabConfig {
  id?: string;
  label?: string;
  enabled?: boolean;
  forceDisplay?: boolean;
  loadContent?: (options?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
  loadingMessage?: string;
  emptyMessage?: string;
  unavailableMessage?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

type LayoutMode = 'split' | 'stacked' | (string & {});

interface DocumentViewerLayoutProps {
  document?: Document | null;
  summaryProps?: Record<string, unknown>;
  metadataPayload?: unknown;
  contentTabConfig?: ContentTabConfig | null;
  resetKey?: string | null;
  classNamePrefix?: string;
  defaultTabId?: string;
  infoPanelProps?: Record<string, unknown>;
  previewLoadingMessage?: string;
  layoutMode?: LayoutMode;
  onTabNavChange?: (node: ReactNode) => void;
}
const DocumentViewerLayout = ({
  document,
  summaryProps = {},
  metadataPayload,
  contentTabConfig,
  resetKey,
  classNamePrefix = 'document-viewer',
  defaultTabId = 'details',
  infoPanelProps = {},
  previewLoadingMessage = 'Preparing preview…',
  layoutMode = 'split',
  onTabNavChange,
}: DocumentViewerLayoutProps): JSX.Element => {
  const isStacked = layoutMode === 'stacked';
  const viewportRef = useRef<HTMLDivElement>(null);

  const previewContent = useMemo(() => (
    <UnifiedDocumentViewer
      document={document}
      viewportRef={viewportRef}
    />
  ), [document, viewportRef]);

  const renderViewportPane = useCallback(() => (
    <div className="document-viewer__viewport" ref={viewportRef}>
      {!resolveDocumentDownloadHref(document) ? (
        <div className="document-viewer__message">{previewLoadingMessage}</div>
      ) : (
        previewContent
      )}
    </div>
  ), [previewContent, document, previewLoadingMessage, viewportRef]);

  const viewportPane = renderViewportPane();

  const stackedLeadingTabs = useMemo(() => (
    isStacked
      ? [
        {
          id: 'preview',
          label: 'Preview',
          icon: <EyeIcon />,
          render: () => renderViewportPane(),
        },
      ]
      : []
  ), [isStacked, renderViewportPane]);

  const resolvedDefaultTabId = isStacked ? 'preview' : defaultTabId;
  const summaryPlacement = 'tabs';
  const tabsPlacement = 'top';
  const summaryLayout = 'compact';

  const detailsPane = (
    <div className="document-viewer__details-pane">
      <div className="document-viewer__details">
        <DocumentInfoPanel
          document={document}
          summaryProps={summaryProps}
          metadataPayload={metadataPayload}
          contentConfig={contentTabConfig}
          defaultTabId={resolvedDefaultTabId}
          classNamePrefix={classNamePrefix}
          hideTabNavWhenSingle={false}
          resetKey={resetKey || document?.id}
          summaryPlacement={summaryPlacement}
          summaryLayout={summaryLayout}
          leadingTabs={stackedLeadingTabs}
          tabsPlacement={tabsPlacement}
          onTabNavChange={onTabNavChange}
          {...infoPanelProps}
        />
      </div>
    </div>
  );

  if (isStacked) {
    return detailsPane;
  }

  return (
    <>
      {detailsPane}
      {viewportPane}
    </>
  );
};

export default DocumentViewerLayout;
