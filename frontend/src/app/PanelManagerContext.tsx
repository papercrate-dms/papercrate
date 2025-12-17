import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useSidebarContext } from '../sidebar/SidebarContext';
import {
  DEFAULT_DETAIL_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MINIMAL_FREE_RATIO,
  MINIMUM_MAIN_CONTENT_WIDTH,
  PANEL_LIMITS,
  PANEL_STORAGE_KEYS,
  SIDEBAR_SOLO_THRESHOLD,
  type PanelKey,
} from '../constants/layout';
import { createSafeContext } from '../utils/createSafeContext';

interface SetPanelWidthOptions {
  commit?: boolean;
  log?: boolean;
}

interface PanelManagerContextValue {
  sidebarWidth: number;
  detailWidth: number;
  sidebarSuppressed: boolean;
  resizingPanel: PanelKey | null;
  setPanelWidth: (panel: PanelKey, width: number, options?: SetPanelWidthOptions) => number;
  startPanelResize: (panel: PanelKey) => void;
  stopPanelResize: () => void;
  getPanelWidth: (panel: PanelKey) => number;
  setDetailActive: (isOpen: boolean) => void;
  closeDetailPanel: () => void;
  collapseSidebar: () => void;
  expandSidebar: () => void;
  registerDetailCloseHandler: (handler?: (() => void) | null) => void;
  detailPanelOpen: boolean;
}

type PanelResizeBindings = {
  panelStyle?: CSSProperties;
  handleProps: {
    onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  };
  isPanelResizing: boolean;
};

const [PanelManagerContext, usePanelManager] = createSafeContext<PanelManagerContextValue>('PanelManager');

const clampPanelWidth = (panel: PanelKey, value: number): number => {
  const numeric = Number(value);
  const limits = PANEL_LIMITS[panel];
  const viewport = window.innerWidth;
  const minLimit = Math.max(0, limits.minPx);
  const ratioMax = Math.round(viewport * limits.maxRatio);
  const rawMax = Math.max(ratioMax, minLimit);
  const maxAllowed = Math.min(rawMax, viewport - MINIMUM_MAIN_CONTENT_WIDTH);
  const targetMax = Math.min(viewport, Math.max(minLimit, maxAllowed));
  return Math.min(Math.max(numeric, minLimit), Math.max(0, targetMax));
};

const readStoredWidth = (panel: PanelKey, fallback: number): number => {
  const raw = window.localStorage.getItem(PANEL_STORAGE_KEYS[panel]);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const persistWidth = (panel: PanelKey, value: number): void => {
  window.localStorage.setItem(PANEL_STORAGE_KEYS[panel], String(Math.round(value)));
};

const applyPanelWidthToRoot = (panel: PanelKey, width: number, active: boolean): void => {
  const varName = panel === 'sidebar' ? '--sidebar-width' : '--detail-panel-width';
  const resolvedValue = panel === 'detail' && !active ? '0px' : `${width}px`;
  document.documentElement.style.setProperty(varName, resolvedValue);
};

interface PanelManagerProviderProps {
  children: ReactNode;
  isOpen?: boolean;
  onClose?: () => void;
}

export const PanelManagerProvider: React.FC<PanelManagerProviderProps> = ({ children, isOpen, onClose }) => {
  const { collapsed, setCollapsed } = useSidebarContext();
  const initialSidebarWidth = readStoredWidth('sidebar', DEFAULT_SIDEBAR_WIDTH);
  const initialDetailWidth = readStoredWidth('detail', DEFAULT_DETAIL_WIDTH);

  const [sidebarWidth, setSidebarWidthState] = useState(() => clampPanelWidth('sidebar', initialSidebarWidth));
  const [detailWidth, setDetailWidthState] = useState(() => clampPanelWidth('detail', initialDetailWidth));
  const [resizingPanel, setResizingPanel] = useState(null);
  const [sidebarSuppressed, setSidebarSuppressed] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(Boolean(isOpen));

  useEffect(() => {
    if (isOpen !== undefined) {
      setDetailPanelOpen(isOpen);
    }
  }, [isOpen]);

  const detailCloseHandlerRef = useRef(null);
  const panelWidthsRef = useRef({ sidebar: sidebarWidth, detail: detailWidth });
  const preferredPanelWidthsRef = useRef({ sidebar: sidebarWidth, detail: detailWidth });

  const closeDetailPanel = useCallback(() => {
    const handler = detailCloseHandlerRef.current;
    handler?.();
    onClose?.();
    if (isOpen === undefined) {
      setDetailPanelOpen(false);
    }
  }, [onClose, isOpen]);

  useEffect(() => {
    panelWidthsRef.current.sidebar = sidebarWidth;
    applyPanelWidthToRoot('sidebar', sidebarWidth, true);
  }, [sidebarWidth]);

  useEffect(() => {
    panelWidthsRef.current.detail = detailWidth;
    applyPanelWidthToRoot('detail', detailWidth, detailPanelOpen);
  }, [detailWidth, detailPanelOpen]);

  const handlePanelLayoutChange = useCallback((
    panel: PanelKey,
    action: 'opened' | 'closed' | 'resized',
    value?: number,
    { detailOpen }: { detailOpen?: boolean } = {},
  ) => {
    const viewportWidth = window.innerWidth;
    const sidebarWidth = panelWidthsRef.current.sidebar;
    const detailWidth = panelWidthsRef.current.detail;
    const freeSpace = viewportWidth - sidebarWidth - detailWidth;
    const freeRatio = viewportWidth > 0 ? freeSpace / viewportWidth : 0;

    const meetsThreshold = freeRatio >= MINIMAL_FREE_RATIO;
    const effectiveDetailOpen = detailOpen ?? detailPanelOpen;

    if (panel === 'detail' && !collapsed) {
      if (action === 'opened' || action === 'resized') {
        setSidebarSuppressed(!meetsThreshold);
      } else if (action === 'closed') {
        setSidebarSuppressed(false);
      }
    }

    if (panel === 'sidebar' && (action === 'opened' || action === 'resized') && !meetsThreshold && effectiveDetailOpen) {
      closeDetailPanel();
    }
  }, [collapsed, closeDetailPanel, detailPanelOpen]);

  const collapseSidebar = useCallback(() => {
    if (!collapsed) {
      setCollapsed(true);
      handlePanelLayoutChange('sidebar', 'closed');
    }
  }, [collapsed, setCollapsed, handlePanelLayoutChange]);

  const setPanelWidth = useCallback(
    (panel: PanelKey, width: number, { commit = true, log = true }: SetPanelWidthOptions = {}) => {
      const clamped = clampPanelWidth(panel, width);

      if (panel === 'sidebar') {
        setSidebarWidthState((prev) => (prev === clamped ? prev : clamped));
      } else {
        setDetailWidthState((prev) => (prev === clamped ? prev : clamped));
      }
      panelWidthsRef.current[panel] = clamped;
      if (commit) {
        preferredPanelWidthsRef.current[panel] = clamped;
        persistWidth(panel, clamped);
      }

      if (log) {
        handlePanelLayoutChange(panel, 'resized', clamped);
      }
      return clamped;
    },
    [handlePanelLayoutChange],
  );

  const resetSidebarPreferredWidth = useCallback(() => {
    if (preferredPanelWidthsRef.current.sidebar === DEFAULT_SIDEBAR_WIDTH) {
      return;
    }
    preferredPanelWidthsRef.current.sidebar = DEFAULT_SIDEBAR_WIDTH;
    persistWidth('sidebar', DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const clampPanelsWithinViewport = useCallback(() => {
    const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
    if (viewportWidth === 0) {
      return;
    }

    const desiredSidebarWidth = preferredPanelWidthsRef.current.sidebar;
    const desiredDetailWidth = preferredPanelWidthsRef.current.detail;

    let sidebarDisplayWidth = Math.min(desiredSidebarWidth, viewportWidth);
    let remainingWidth = Math.max(0, viewportWidth - sidebarDisplayWidth);
    let detailDisplayWidth = Math.min(desiredDetailWidth, remainingWidth);
    if (detailPanelOpen && sidebarDisplayWidth > viewportWidth * SIDEBAR_SOLO_THRESHOLD) {
      sidebarDisplayWidth = 0;
      detailDisplayWidth = Math.min(desiredDetailWidth || viewportWidth, viewportWidth);
    } else if (sidebarDisplayWidth > viewportWidth * SIDEBAR_SOLO_THRESHOLD) {
      sidebarDisplayWidth = viewportWidth;
      detailDisplayWidth = 0;
      resetSidebarPreferredWidth();
    }

    panelWidthsRef.current.sidebar = sidebarDisplayWidth;
    panelWidthsRef.current.detail = detailDisplayWidth;

    setSidebarWidthState((prev) => (prev === sidebarDisplayWidth ? prev : sidebarDisplayWidth));
    setDetailWidthState((prev) => (prev === detailDisplayWidth ? prev : detailDisplayWidth));
  }, [detailPanelOpen, resetSidebarPreferredWidth]);

  useEffect(() => {
    clampPanelsWithinViewport();
    window.addEventListener('resize', clampPanelsWithinViewport);
    return () => window.removeEventListener('resize', clampPanelsWithinViewport);
  }, [clampPanelsWithinViewport]);

  const registerDetailCloseHandler = useCallback((handler: (() => void) | null = null) => {
    detailCloseHandlerRef.current = handler ?? null;
  }, []);

  const setDetailActive = useCallback(
    (active) => {
      if (isOpen === undefined) {
        setDetailPanelOpen(Boolean(active));
      }
      if (!active) {
        onClose?.();
      }
      handlePanelLayoutChange('detail', active ? 'opened' : 'closed');
    },
    [handlePanelLayoutChange, isOpen, onClose],
  );

  const expandSidebar = useCallback(() => {
    if (collapsed) {
      setCollapsed(false);
    }
    handlePanelLayoutChange('sidebar', 'opened');
  }, [collapsed, setCollapsed, handlePanelLayoutChange]);

  const startPanelResize = useCallback((panel) => {
    setResizingPanel(panel);
  }, []);

  const stopPanelResize = useCallback(() => {
    setResizingPanel(null);
  }, []);

  const getPanelWidth = useCallback((panel) => panelWidthsRef.current[panel] || 0, []);

  const contextValue = useMemo(
    () => ({
      sidebarWidth,
      detailWidth,
      sidebarSuppressed,
      resizingPanel,
      setPanelWidth,
      startPanelResize,
      stopPanelResize,
      getPanelWidth,
      setDetailActive,
      closeDetailPanel,
      collapseSidebar,
      expandSidebar,
      registerDetailCloseHandler,
      detailPanelOpen,
    }),
    [
      sidebarWidth,
      detailWidth,
      sidebarSuppressed,
      resizingPanel,
      setPanelWidth,
      startPanelResize,
      stopPanelResize,
      getPanelWidth,
      setDetailActive,
      closeDetailPanel,
      collapseSidebar,
      expandSidebar,
      registerDetailCloseHandler,
      detailPanelOpen,
    ],
  );

  return <PanelManagerContext.Provider value={contextValue}>{children}</PanelManagerContext.Provider>;
};

export { usePanelManager };

export const usePanelResizeBindings = (
  panel: PanelKey,
  { panelRef = null, enabled = true }: { panelRef?: RefObject<HTMLElement> | null; enabled?: boolean } = {},
): PanelResizeBindings => {
  const {
    sidebarWidth,
    detailWidth,
    resizingPanel,
    setPanelWidth,
    startPanelResize,
    stopPanelResize,
    getPanelWidth,
  } = usePanelManager();

  const liveWidth = panel === 'sidebar' ? sidebarWidth : detailWidth;
  const latestWidthRef = useRef(liveWidth);
  const cleanupRef = useRef(null);

  useEffect(() => {
    latestWidthRef.current = liveWidth;
  }, [liveWidth]);

  const teardownListeners = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    stopPanelResize();
  }, [stopPanelResize]);

  useEffect(() => () => teardownListeners(), [teardownListeners]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled || !panelRef?.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rect = panelRef.current.getBoundingClientRect();
      const startWidth = rect?.width ?? getPanelWidth(panel);
      const pointerId = event.pointerId ?? 'mouse';
      const startX = event.clientX;
      startPanelResize(panel);
      event.currentTarget?.setPointerCapture?.(pointerId);
      let lastWidth = startWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = panel === 'sidebar'
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
        lastWidth = setPanelWidth(panel, startWidth + delta, { commit: false });
        latestWidthRef.current = lastWidth;
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        event.currentTarget?.releasePointerCapture?.(pointerId);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        setPanelWidth(panel, lastWidth);
        teardownListeners();
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    },
    [
      enabled,
      panelRef,
      panel,
      getPanelWidth,
      startPanelResize,
      setPanelWidth,
      teardownListeners,
    ],
  );

  const panelStyle = enabled ? { width: `${liveWidth}px` } : undefined;

  const handleProps = enabled
    ? {
      onPointerDown: handlePointerDown,
    }
    : {};

  return {
    panelStyle,
    handleProps,
    isPanelResizing: resizingPanel === panel,
  };
};
