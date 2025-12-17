import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import {
  DARK_MODE_MEDIA_QUERY,
  DEFAULT_NEUTRAL_CHROMA,
  DEFAULT_NEUTRAL_HUE,
  DEFAULT_THEME_MODE,
  SIDEBAR_COLLAPSE_STORAGE_KEY,
  THEME_MODES,
  THEME_STORAGE_KEY,
} from '../constants/sidebar';
import { createSafeContext } from '../utils/createSafeContext';

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  neutralHue: number;
  setNeutralHue: (value: number | string) => void;
  resetNeutralHue: () => void;
  neutralChroma: number;
  setNeutralChroma: (value: number | string) => void;
  resetNeutralChroma: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  cycleThemeMode: () => void;
  themeModes: ThemeMode[];
}

type ThemeMode = (typeof THEME_MODES)[number];

const [SidebarContext, useSidebarContext] = createSafeContext<SidebarContextValue>('Sidebar');

const loadInitialThemeSettings = () => {
  const defaults = {
    neutralHue: DEFAULT_NEUTRAL_HUE,
    neutralChroma: DEFAULT_NEUTRAL_CHROMA,
    mode: DEFAULT_THEME_MODE,
  };

  const root = document.documentElement;
  const readNumberVar = (name, fallback) => {
    const inlineValue = root.style.getPropertyValue(name);
    const inlineParsed = Number.parseFloat(inlineValue);
    if (!Number.isNaN(inlineParsed)) {
      return inlineParsed;
    }
    const computedValue = window.getComputedStyle(root).getPropertyValue(name);
    const computedParsed = Number.parseFloat(computedValue);
    if (!Number.isNaN(computedParsed)) {
      return computedParsed;
    }
    return fallback;
  };

  const loadFromRoot = () => {
    const current = root.style.getPropertyValue('--neutral-hue');
    const parsed = Number.parseInt(current, 10);
    return {
      neutralHue: Number.isNaN(parsed) ? defaults.neutralHue : parsed,
      neutralChroma: readNumberVar('--neutral-chroma', defaults.neutralChroma),
    };
  };

  const rootValues = loadFromRoot();
  let neutralHueValue = rootValues.neutralHue;
  let neutralChromaValue = rootValues.neutralChroma;
  let modeValue = defaults.mode;

  const composite = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (composite) {
    try {
      const parsed = JSON.parse(composite);
      const storedHue = Number.parseInt(parsed?.neutralHue, 10);
      if (!Number.isNaN(storedHue)) {
        neutralHueValue = storedHue;
      }
      const storedChroma = Number.parseFloat(parsed?.neutralChroma);
      if (!Number.isNaN(storedChroma)) {
        neutralChromaValue = Math.min(Math.max(storedChroma, 0), 1);
      }

      const storedMode = parsed?.mode;
      if (THEME_MODES.includes(storedMode)) {
        modeValue = storedMode;
      }
    } catch (error) {
      console.warn('[theme] failed to parse stored theme settings', error);
    }
  } else {
    const legacyHue = window.localStorage.getItem('papercrate_neutral_hue');
    if (legacyHue) {
      const parsedLegacyHue = Number.parseInt(legacyHue, 10);
      if (!Number.isNaN(parsedLegacyHue)) {
        neutralHueValue = parsedLegacyHue;
      }
    }
    const legacyMode = window.localStorage.getItem('papercrate_theme_mode');
    if (THEME_MODES.includes(legacyMode)) {
      modeValue = legacyMode;
    }
  }

  return {
    neutralHue: neutralHueValue,
    neutralChroma: neutralChromaValue,
    mode: modeValue,
  };
};

const loadInitialCollapsedState = (defaultValue) => {
  try {
    const stored = window.sessionStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
    if (stored === '1' || stored === 'true') {
      return true;
    }
    if (stored === '0' || stored === 'false') {
      return false;
    }
  } catch (error) {
    console.warn('[sidebar] failed to read collapse state', error);
  }
  return Boolean(defaultValue);
};

export const SidebarProvider = ({ initialCollapsed = false, children }) => {
  const [collapsed, setCollapsedState] = useState(() => loadInitialCollapsedState(initialCollapsed));
  const initialTheme = useMemo(() => loadInitialThemeSettings(), []);
  const [neutralHue, setNeutralHueState] = useState(initialTheme.neutralHue);
  const [neutralChroma, setNeutralChromaState] = useState(initialTheme.neutralChroma);
  const [themeMode, setThemeModeState] = useState(initialTheme.mode);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(DARK_MODE_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--neutral-hue', `${neutralHue}deg`);
  }, [neutralHue]);

  useEffect(() => {
    document.documentElement.style.setProperty('--neutral-chroma', String(neutralChroma));
  }, [neutralChroma]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return () => undefined;
    }
    const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);
    const handler = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
    mediaQuery.addListener(handler);
    return () => mediaQuery.removeListener(handler);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'system') {
      if (systemPrefersDark) {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.removeAttribute('data-theme');
      }
      return;
    }
    root.setAttribute('data-theme', themeMode);
  }, [themeMode, systemPrefersDark]);

  useEffect(() => {
    try {
      const payload = JSON.stringify({
        neutralHue,
        neutralChroma,
        mode: themeMode,
      });
      window.localStorage.setItem(THEME_STORAGE_KEY, payload);
      window.localStorage.removeItem('papercrate_neutral_hue');
      window.localStorage.removeItem('papercrate_theme_mode');
    } catch (error) {
      console.warn('[theme] failed to persist theme settings', error);
    }
  }, [neutralHue, neutralChroma, themeMode]);

  const setNeutralHue = useCallback((value) => {
    setNeutralHueState((prev) => {
      if (value === '' || value === null || value === undefined) {
        return DEFAULT_NEUTRAL_HUE;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }
      const clamped = Math.min(Math.max(Math.round(parsed), 0), 360);
      return clamped;
    });
  }, []);

  const setNeutralChroma = useCallback((value) => {
    setNeutralChromaState((prev) => {
      if (value === '' || value === null || value === undefined) {
        return DEFAULT_NEUTRAL_CHROMA;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }
      const clamped = Math.min(Math.max(parsed, 0), 1);
      return Math.round(clamped * 1000) / 1000;
    });
  }, []);

  const resetNeutralChroma = useCallback(() => {
    setNeutralChromaState(DEFAULT_NEUTRAL_CHROMA);
  }, []);

  const resetNeutralHue = useCallback(() => {
    setNeutralHueState(DEFAULT_NEUTRAL_HUE);
  }, []);

  const setThemeMode = useCallback((mode) => {
    if (!THEME_MODES.includes(mode)) {
      return;
    }
    setThemeModeState(mode);
  }, []);

  const cycleThemeMode = useCallback(() => {
    const index = THEME_MODES.indexOf(themeMode);
    const nextIndex = index === -1 ? 0 : (index + 1) % THEME_MODES.length;
    setThemeModeState(THEME_MODES[nextIndex]);
  }, [themeMode]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
    } catch (error) {
      console.warn('[sidebar] failed to persist collapse state', error);
    }
  }, [collapsed]);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(Boolean(value));
  }, []);

  const contextValue = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      neutralHue,
      setNeutralHue,
      neutralChroma,
      setNeutralChroma,
      resetNeutralHue,
      resetNeutralChroma,
      themeMode,
      setThemeMode,
      cycleThemeMode,
      themeModes: THEME_MODES,
      defaultNeutralHue: DEFAULT_NEUTRAL_HUE,
      defaultNeutralChroma: DEFAULT_NEUTRAL_CHROMA,
    }),
    [
      collapsed,
      setCollapsed,
      neutralHue,
      setNeutralHue,
      neutralChroma,
      setNeutralChroma,
      resetNeutralHue,
      resetNeutralChroma,
      themeMode,
      setThemeMode,
      cycleThemeMode,
    ],
  );

  return <SidebarContext.Provider value={contextValue}>{children}</SidebarContext.Provider>;
};

export { useSidebarContext };
