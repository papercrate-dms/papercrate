import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import DocumentSummarySection, { DocumentSummarySectionProps } from './DocumentSummarySection';
import { describeDocumentSummary, extractDocumentMetadataPayload, type DocumentSummaryRow } from '../logic/documentSummary';
import { useTags } from '../../lib/context/TagsContext';
import { useCorrespondents } from '../../lib/context/CorrespondentsContext';
import { EyeIcon, InfoIcon, FileTextIcon, CodeIcon } from '../../components/icons';
import VirtualizedTextViewer from './VirtualizedTextViewer';

type TabDescriptor = { id: string; label: string; icon?: ReactNode };
type PanelTab = TabDescriptor & { render: (context?: Record<string, unknown>) => ReactNode };

type ContentState =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'loaded'; data: string; error: null }
  | { status: 'empty'; data: string; error: null }
  | { status: 'unavailable'; data: null; error: null }
  | { status: 'error'; data: null; error: unknown };

export interface DocumentInfoPanelProps {
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

const EMPTY_TABS: PanelTab[] = [];
const EMPTY_SUMMARY_PROPS: Omit<DocumentSummarySectionProps, 'document' | 'layout'> = {};

const DocumentInfoPanel: React.FC<DocumentInfoPanelProps> = ({
  document,
  summaryProps = EMPTY_SUMMARY_PROPS,
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
  leadingTabs = EMPTY_TABS,
  trailingTabs = EMPTY_TABS,
  tabsPlacement = 'top',
  summaryLayout = 'default',
  onTabNavChange,
}) => {
  const base = classNamePrefix;
  const { tagLookupById } = useTags();
  const { correspondentLookupById } = useCorrespondents();

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

  // ------------------------------------------------------------------
  //  Render functions (called lazily when a tab is active)
  // ------------------------------------------------------------------

  const renderSummarySection = useCallback(() => (
    <DocumentSummarySection
      document={document}
      layout={summaryLayout}
      {...summaryProps}
    />
  ), [document, summaryLayout, summaryProps]);

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

  // ------------------------------------------------------------------
  //  Tab structure (stable) — only ids, labels, icons
  //  Used for the tab bar and for determining which tabs exist.
  //  Does NOT depend on contentConfig, contentState, metadataPayload,
  //  or any other value that changes frequently.
  // ------------------------------------------------------------------

  const contentTabId = contentConfig?.id || 'content';
  const contentTabLabel = contentConfig?.label || 'Content';
  const hasMetadata = Boolean(metadataPayload);

  const tabDescriptors: TabDescriptor[] = useMemo(() => {
    const tabs: TabDescriptor[] = [];

    if (normalizedLeadingTabs.length) {
      tabs.push(...normalizedLeadingTabs.map(({ id, label, icon }) => ({ id, label, icon })));
    }

    if (summaryPlacement === 'tabs') {
      tabs.push({ id: summaryTabId, label: summaryTabLabel, icon: <InfoIcon /> });
    } else {
      tabs.push({ id: 'details', label: detailsTabLabel, icon: <InfoIcon /> });
    }

    if (showContentTab) {
      tabs.push({ id: contentTabId, label: contentTabLabel, icon: <FileTextIcon /> });
    }

    if (hasMetadata) {
      tabs.push({ id: 'metadata', label: metadataTabLabel, icon: <CodeIcon /> });
    }

    if (normalizedTrailingTabs.length) {
      tabs.push(...normalizedTrailingTabs.map(({ id, label, icon }) => ({ id, label, icon })));
    }

    return tabs;
  }, [
    normalizedLeadingTabs,
    normalizedTrailingTabs,
    summaryPlacement,
    summaryTabId,
    summaryTabLabel,
    detailsTabLabel,
    showContentTab,
    contentTabId,
    contentTabLabel,
    hasMetadata,
    metadataTabLabel,
  ]);

  // ------------------------------------------------------------------
  //  Tab content rendering — reads current state at call time
  // ------------------------------------------------------------------

  const renderTabContent = useCallback((tabId: string): ReactNode => {
    // Leading tabs
    const leading = normalizedLeadingTabs.find((t) => t.id === tabId);
    if (leading) return leading.render({ document });

    // Summary tab
    if (tabId === summaryTabId && summaryPlacement === 'tabs') {
      return (
        <div className={`${base}__summary-tab-content`}>
          {renderSummarySection()}
        </div>
      );
    }

    // Details tab
    if (tabId === 'details' && summaryPlacement !== 'tabs') {
      return renderDetailsSection();
    }

    // Content tab
    if (tabId === contentTabId) {
      const messageClass = `${base}__message`;
      const errorClass = `${base}__message ${base}__message--error`;
      const objectClass = `${base}__object ${base}__object--text-content`;

      if (!contentEnabled || !contentConfig?.loadContent) {
        return (
          <div className={messageClass}>
            {contentConfig?.unavailableMessage || 'Content not available.'}
          </div>
        );
      }

      if (!contentState) {
        return (
          <div className={messageClass}>
            {contentConfig?.emptyMessage || 'No content available.'}
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
            <VirtualizedTextViewer
              text={contentState.data}
              className={objectClass}
            />
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
    }

    // Metadata tab
    if (tabId === 'metadata' && metadataPayload) {
      return (
        <section className={`${base}__section ${base}__section--metadata-json`}>
          <pre className={`${base}__metadata-json`}>
            {JSON.stringify(metadataPayload, null, 2)}
          </pre>
        </section>
      );
    }

    // Trailing tabs
    const trailing = normalizedTrailingTabs.find((t) => t.id === tabId);
    if (trailing) return trailing.render({ document });

    return null;
  }, [
    base,
    document,
    contentConfig,
    contentEnabled,
    contentState,
    contentTabId,
    metadataPayload,
    normalizedLeadingTabs,
    normalizedTrailingTabs,
    renderDetailsSection,
    renderSummarySection,
    summaryPlacement,
    summaryTabId,
  ]);

  // ------------------------------------------------------------------
  //  Tab selection state
  // ------------------------------------------------------------------

  const fallbackTabId = useMemo(() => {
    if (!tabDescriptors.length) {
      return null;
    }
    if (defaultTabId && tabDescriptors.some((tab) => tab.id === defaultTabId)) {
      return defaultTabId;
    }
    return tabDescriptors[0].id;
  }, [tabDescriptors, defaultTabId]);

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
    if (isControlled && controlledActiveTab && !tabDescriptors.some((tab) => tab.id === controlledActiveTab)) {
      const nextTab = fallbackTabId;
      if (nextTab && nextTab !== controlledActiveTab) {
        onTabChange?.(nextTab);
      }
    }
  }, [isControlled, controlledActiveTab, tabDescriptors, fallbackTabId, onTabChange]);

  const activeTabId = isControlled ? controlledActiveTab : uncontrolledTab;

  // ------------------------------------------------------------------
  //  Content state machine (unchanged from original)
  // ------------------------------------------------------------------

  const prevDocIdRef = React.useRef(document?.id);
  const prevResetKeyRef = React.useRef(resetKey);
  const activeControllerRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    const docIdChanged = prevDocIdRef.current !== document?.id;
    const resetKeyChanged = prevResetKeyRef.current !== resetKey;
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

  useEffect(() => {
    return () => {
      activeControllerRef.current?.abort();
      contentConfig?.onCancel?.();
    };
  }, [activeTabId, contentConfig, loadContent, contentEnabled, document?.id]);

  useEffect(() => {
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
    contentTabId,
  ]);

  // ------------------------------------------------------------------
  //  Tab bar (depends only on stable tabDescriptors + activeTabId)
  // ------------------------------------------------------------------

  const handleTabSelect = useCallback((tabId: string) => {
    if (!tabDescriptors.some((tab) => tab.id === tabId)) {
      return;
    }
    if (!isControlled) {
      setUncontrolledTab(tabId);
    }
    if (tabId !== activeTabId) {
      onTabChange?.(tabId);
    }
  }, [tabDescriptors, isControlled, activeTabId, onTabChange]);

  const singleTab = tabDescriptors.length === 1 ? tabDescriptors[0] : null;
  const shouldHideNav = hideTabNavWhenSingle && singleTab;

  const tabNav = useMemo(() => {
    if (shouldHideNav) return null;
    return (
      <div className={`${base}__tabs`} role="tablist" aria-label="Document details">
        {tabDescriptors.map((tab) => (
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
  }, [shouldHideNav, base, tabDescriptors, activeTabId, handleTabSelect]);

  // Sync tab nav to parent via callback
  useEffect(() => {
    if (onTabNavChange) onTabNavChange(tabNav);
  }, [onTabNavChange, tabNav]);

  // ------------------------------------------------------------------
  //  Render
  // ------------------------------------------------------------------

  const tabPanels = (
    <div className={`${base}__tabpanes`}>
      {tabDescriptors.map((tab) => (
        tab.id === activeTabId ? (
          <div key={tab.id} role="tabpanel" className={`${base}__tabpanel`}>
            {renderTabContent(tab.id)}
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
