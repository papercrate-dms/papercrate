import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import DocumentSummarySection, { DocumentSummarySectionProps } from './DocumentSummarySection';
import { describeDocumentSummary, extractDocumentMetadataPayload, type DocumentSummaryRow } from '../logic/documentSummary';
import type { Tag, Correspondent } from '../../types/documents';
import type { TagId, Identifier } from '../../types/identifiers';
import { EyeIcon, InfoIcon, FileTextIcon, CodeIcon } from '../../components/icons';

type PanelTab = { id: string; label: string; icon?: ReactNode; render: (context?: Record<string, unknown>) => ReactNode };

type ContentState =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'loaded'; data: string; error: null }
  | { status: 'empty'; data: string; error: null }
  | { status: 'unavailable'; data: null; error: null }
  | { status: 'error'; data: null; error: unknown };

export interface DocumentInfoPanelProps {
  tagLookupById?: Map<TagId, Tag>;
  correspondentLookupById?: Map<Identifier, Correspondent>;
  summaryProps?: Omit<DocumentSummarySectionProps, 'document' | 'layout'>;
  metadataItems?: DocumentSummaryRow[];
  metadataPayload?: Record<string, unknown>;
  metadataTabLabel?: string;
  detailsTabLabel?: string;
  contentConfig?: {
    id?: string;
    label?: string;
    enabled?: boolean;
    forceDisplay?: boolean;
    loadContent?: (args: { signal: AbortSignal }) => Promise<string>;
    onCancel?: () => void;
    loadingMessage?: string;
    emptyMessage?: string;
    unavailableMessage?: string;
    errorMessage?: string;
    renderContent?: (data: string) => ReactNode;
  } | null;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  defaultTabId?: string;
  resetKey?: string | null;
  classNamePrefix?: string;
  hideTabNavWhenSingle?: boolean;
  summaryPlacement?: 'inline' | 'tabs';
  summaryTabLabel?: string;
  summaryTabId?: string;
  leadingTabs?: PanelTab[];
  trailingTabs?: PanelTab[];
  tabsPlacement?: 'top' | 'bottom';
  onTabNavChange?: (node: ReactNode) => void;
  summaryLayout?: 'default' | 'compact';
}

const DocumentInfoPanel: React.FC<DocumentInfoPanelProps> = ({
  document,
  tagLookupById,
  correspondentLookupById,
  summaryProps = {},
  metadataItems: metadataItemsProp,
  metadataPayload: metadataPayloadProp,
  metadataTabLabel = 'Metadata',
  detailsTabLabel = 'Details',
  contentConfig: contentConfigProp = null,
  activeTab: controlledActiveTab,
  onTabChange,
  defaultTabId = 'details',
  resetKey = null,
  classNamePrefix = 'document-info',
  hideTabNavWhenSingle = true,
  summaryPlacement = 'inline',
  summaryTabLabel = 'Summary',
  summaryTabId = 'summary',
  leadingTabs = [],
  trailingTabs = [],
  tabsPlacement = 'top',
  summaryLayout = 'default',
  onTabNavChange,
}) => {
  const base = classNamePrefix;

  const metadataItems = useMemo(() => {
    if (Array.isArray(metadataItemsProp) && metadataItemsProp.length) {
      return metadataItemsProp;
    }

    return describeDocumentSummary(document, { tagLookupById, correspondentLookupById });
  }, [metadataItemsProp, document, tagLookupById, correspondentLookupById]);

  const metadataPayload = useMemo(() => {
    if (metadataPayloadProp !== undefined) {
      return metadataPayloadProp;
    }
    return extractDocumentMetadataPayload(document);
  }, [metadataPayloadProp, document]);

  const contentConfig = contentConfigProp || null;
  const contentEnabled = Boolean(contentConfig && (contentConfig.enabled ?? true));
  const loadContent = contentConfig?.loadContent ?? null;
  const showContentTab = Boolean(contentConfig && (contentConfig.forceDisplay ?? contentEnabled));

  const [contentState, setContentState] = useState<ContentState | null>(() => {
    if (!contentConfig) {
      return null;
    }
    if (!contentEnabled || !loadContent) {
      return { status: contentEnabled ? 'idle' : 'unavailable', data: null, error: null };
    }
    return { status: 'idle', data: null, error: null };
  });



  const renderSummarySection = useCallback(() => (
    <DocumentSummarySection
      document={document}
      layout={summaryLayout}
      correspondentLookupById={correspondentLookupById}
      {...summaryProps}
    />
  ), [document, summaryLayout, summaryProps, correspondentLookupById]);

  const renderDetailsSection = useCallback(() => (
    <section className={`${base}__section`}>
      {metadataItems.length ? (
        <dl className={`${base}__section-list`}>
          {metadataItems.map(({ key, label, value }) => (
            <div className={`${base}__section-item`} key={key || label}>
              <dt>{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={`${base}__section-placeholder`}>No details available.</p>
      )}
    </section>
  ), [base, metadataItems]);

  const summaryInline = summaryPlacement !== 'tabs';

  const summaryTab = useMemo(() => {
    if (summaryPlacement !== 'tabs') {
      return null;
    }
    return {
      id: summaryTabId,
      label: summaryTabLabel,
      icon: <InfoIcon />,
      render: () => (
        <div className={`${base}__summary-tab-content`}>
          {renderSummarySection()}
        </div>
      ),
    };
  }, [summaryPlacement, summaryTabId, summaryTabLabel, base, renderSummarySection]);

  const normalizedLeadingTabs = useMemo(
    () => (Array.isArray(leadingTabs)
      ? leadingTabs.filter((tab): tab is PanelTab => Boolean(tab && tab.id && tab.label))
      : []),
    [leadingTabs],
  );

  const normalizedTrailingTabs = useMemo(
    () => (Array.isArray(trailingTabs)
      ? trailingTabs.filter((tab): tab is PanelTab => Boolean(tab && tab.id && tab.label))
      : []),
    [trailingTabs],
  );

  const summaryNode = summaryInline
    ? (
      <>
        {renderSummarySection()}
        {renderDetailsSection()}
      </>
    )
    : null;

  const visibleTabs = useMemo(() => {
    const tabsList: PanelTab[] = [];

    if (normalizedLeadingTabs.length) {
      tabsList.push(...normalizedLeadingTabs);
    }

    if (summaryTab) {
      tabsList.push(summaryTab);
    }

    if (summaryPlacement !== 'tabs') {
      tabsList.push({
        id: 'details',
        label: detailsTabLabel,
      icon: <InfoIcon />,
        render: () => renderDetailsSection(),
      });
    }

    if (showContentTab && contentConfig) {
      tabsList.push({
        id: contentConfig.id || 'content',
        label: contentConfig.label || 'Content',
        icon: <FileTextIcon />,
        render: () => {
          const messageClass = `${base}__message`;
          const errorClass = `${base}__message ${base}__message--error`;
          const objectClass = `${base}__object ${base}__object--text-content`;

          if (!contentEnabled || !contentConfig.loadContent) {
            return (
              <div className={messageClass}>
                {contentConfig.unavailableMessage || 'Content not available.'}
              </div>
            );
          }

          if (!contentState) {
            return (
              <div className={messageClass}>
                {contentConfig.emptyMessage || 'No content available.'}
              </div>
            );
          }

          switch (contentState.status) {
            case 'loading':
              return (
                <div className={messageClass}>
                  {contentConfig.loadingMessage || 'Loading content…'}
                </div>
              );
            case 'error': {
              const errorMessage =
                contentConfig.errorMessage
                || (contentState.error instanceof Error ? contentState.error.message : null)
                || 'Failed to load content.';
              return <div className={errorClass}>{errorMessage}</div>;
            }
            case 'empty':
              return (
                <div className={messageClass}>
                  {contentConfig.emptyMessage || 'No content available.'}
                </div>
              );
            case 'loaded':
              return (
                <pre className={objectClass}>{contentState.data}</pre>
              );
            case 'unavailable':
              return (
                <div className={messageClass}>
                  {contentConfig.unavailableMessage || 'Content not available.'}
                </div>
              );
            default:
              return (
                <div className={messageClass}>
                  {contentConfig.emptyMessage || 'No content available.'}
                </div>
              );
          }
        },
      });
    }

    if (metadataPayload) {
      tabsList.push({
        id: 'metadata',
        label: metadataTabLabel,
        icon: <CodeIcon />,
        render: () => (
          <section className={`${base}__section ${base}__section--metadata-json`}>
            <pre className={`${base}__metadata-json`}>
              {JSON.stringify(metadataPayload, null, 2)}
            </pre>
          </section>
        ),
      });
    }

    if (normalizedTrailingTabs.length) {
      tabsList.push(...normalizedTrailingTabs);
    }

    return tabsList;
  }, [
    base,
    detailsTabLabel,
    contentConfig,
    contentEnabled,
    contentState,
    metadataPayload,
    metadataTabLabel,
    showContentTab,
    summaryTab,
    normalizedLeadingTabs,
    normalizedTrailingTabs,
    summaryPlacement,
    renderDetailsSection,
  ]);

  const fallbackTabId = useMemo(() => {
    if (!visibleTabs.length) {
      return null;
    }
    if (defaultTabId && visibleTabs.some((tab) => tab.id === defaultTabId)) {
      return defaultTabId;
    }
    return visibleTabs[0].id;
  }, [visibleTabs, defaultTabId]);

  const renderTabContent = (tab?: PanelTab | null, context: Record<string, unknown> = {}) => {
    if (!tab) {
      return null;
    }
    if (!tab.render) {
      return null;
    }
    return tab.render(context);
  };

  const isControlled = controlledActiveTab !== undefined && controlledActiveTab !== null;
  const [uncontrolledTab, setUncontrolledTab] = useState(
    isControlled ? controlledActiveTab : fallbackTabId,
  );

  useEffect(() => {
    if (!isControlled) {
      setUncontrolledTab(fallbackTabId);
    }
  }, [fallbackTabId, isControlled]);

  useEffect(() => {
    if (isControlled && controlledActiveTab && !visibleTabs.some((tab) => tab.id === controlledActiveTab)) {
      const nextTab = fallbackTabId;
      if (nextTab && nextTab !== controlledActiveTab) {
        onTabChange?.(nextTab);
      }
    }
  }, [isControlled, controlledActiveTab, visibleTabs, fallbackTabId, onTabChange]);

  const activeTabId = isControlled ? controlledActiveTab : uncontrolledTab;

  // Track previous ID/key to avoid unnecessary resets on prop reference changes
  const prevDocIdRef = React.useRef(document?.id);
  const prevResetKeyRef = React.useRef(resetKey);
  const activeControllerRef = React.useRef<AbortController | null>(null);

  // Reset content state when document changes or contentConfig becomes available
  useEffect(() => {
    const docIdChanged = prevDocIdRef.current !== document?.id;
    const resetKeyChanged = prevResetKeyRef.current !== resetKey;
    // Check if we need to initialize state (e.g. contentConfig was loaded asynchronously)
    const needsInit = contentConfig && !contentState;

    if (docIdChanged || resetKeyChanged || needsInit) {
      prevDocIdRef.current = document?.id;
      prevResetKeyRef.current = resetKey;

      if (!contentConfig || !showContentTab) {
        setContentState(null);
        return;
      }
      if (!contentEnabled || !loadContent) {
        setContentState({ status: contentEnabled ? 'idle' : 'unavailable', data: null, error: null });
        return;
      }
      // Reset to idle so the loading effect can trigger if needed
      setContentState({ status: 'idle', data: null, error: null });
    }
  }, [
    contentConfig,
    showContentTab,
    contentEnabled,
    loadContent,
    document?.id,
    resetKey,
    contentState,
  ]);

  // Cleanup effect: aborts when inputs change or component unmounts
  useEffect(() => {
    return () => {
      activeControllerRef.current?.abort();
      contentConfig?.onCancel?.();
    };
  }, [activeTabId, contentConfig, loadContent, contentEnabled, document?.id]);

  // Loading effect: triggers load when status is idle
  useEffect(() => {
    const contentTabId = contentConfig?.id || 'content';
    const isActive = activeTabId === contentTabId;

    if (!isActive || !contentConfig || !loadContent || !contentEnabled) {
      return;
    }

    if (contentState?.status !== 'idle') {
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;

    setContentState({ status: 'loading', data: null, error: null });

    Promise.resolve(loadContent({ signal: controller.signal }))
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        if (result && result.length) {
          setContentState({ status: 'loaded', data: result, error: null });
        } else {
          setContentState({ status: 'empty', data: '', error: null });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          return;
        }
        setContentState({
          status: 'error',
          data: null,
          error,
        });
      });
  }, [
    activeTabId,
    contentConfig,
    loadContent,
    contentEnabled,
    contentState?.status,
    document?.id,
  ]);

  const handleTabSelect = useCallback((tabId) => {
    if (!visibleTabs.some((tab) => tab.id === tabId)) {
      return;
    }
    if (!isControlled) {
      setUncontrolledTab(tabId);
    }
    if (tabId !== activeTabId) {
      onTabChange?.(tabId);
    }
  }, [visibleTabs, isControlled, activeTabId, onTabChange]);

  const singleTab = visibleTabs.length === 1 ? visibleTabs[0] : null;
  const shouldHideNav = hideTabNavWhenSingle && singleTab;

  const tabNav = useMemo(() => {
    if (shouldHideNav) return null;
    return (
      <div className={`${base}__tabs`} role="tablist" aria-label="Document details">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            aria-label={tab.label}
            title={tab.label}
            className={`${base}__tab${tab.id === activeTabId ? ' is-active' : ''}`}
            onClick={() => handleTabSelect(tab.id)}
          >
            {tab.icon}
          </button>
        ))}
      </div>
    );
  }, [shouldHideNav, base, visibleTabs, activeTabId, handleTabSelect]);

  // Sync tab nav to parent via callback
  useEffect(() => {
    if (onTabNavChange) onTabNavChange(tabNav);
  }, [onTabNavChange, tabNav]);

  const tabPanels = (
    <div className={`${base}__tabpanes`}>
      {visibleTabs.map((tab) => (
        tab.id === activeTabId ? (
          <div key={tab.id} role="tabpanel" className={`${base}__tabpanel`}>
            {renderTabContent(tab, { document })}
          </div>
        ) : null
      ))}
    </div>
  );

  const renderInlineNav = !onTabNavChange && !shouldHideNav;
  const tabsWrapperClass = `${base}__tabs-wrapper${tabsPlacement === 'bottom' ? ` ${base}__tabs-wrapper--bottom` : ''}`;

  return (
    <>
      {summaryNode}
      <div className={tabsWrapperClass}>
        {renderInlineNav && tabsPlacement !== 'bottom' ? tabNav : null}
        {tabsPlacement === 'bottom' ? tabPanels : null}
        {renderInlineNav && tabsPlacement === 'bottom' ? tabNav : null}
        {tabsPlacement !== 'bottom' ? tabPanels : null}
      </div>
    </>
  );
};

export default DocumentInfoPanel;
