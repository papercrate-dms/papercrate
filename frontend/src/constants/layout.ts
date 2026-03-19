export const DEFAULT_SIDEBAR_WIDTH = 320;
export const DEFAULT_DETAIL_WIDTH = 420;
export const MINIMAL_FREE_RATIO = 1 / 4;
export const SIDEBAR_SOLO_THRESHOLD = 1 / 2;
export const MINIMUM_MAIN_CONTENT_WIDTH = 160;

export type PanelKey = 'sidebar' | 'detail';

export const PANEL_LIMITS: Record<PanelKey, { maxRatio: number; minPx: number }> = {
  sidebar: {
    maxRatio: 1 / 4,
    minPx: 280,
  },
  detail: {
    maxRatio: 2 / 5,
    minPx: 320,
  },
};

export const PANEL_STORAGE_KEYS: Record<PanelKey, string> = {
  sidebar: 'papercrate_sidebar_width',
  detail: 'papercrate_detail_width',
};
