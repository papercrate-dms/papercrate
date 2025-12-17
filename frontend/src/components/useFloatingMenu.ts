import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, CSSProperties } from 'react';
import { clamp } from '../utils/math';
import { DEFAULT_VIEWPORT_MARGIN } from '../constants/ui';

type PositionStrategy = 'fixed' | 'absolute' | (string & {});

interface FloatingMenuMetrics {
  strategy: PositionStrategy;
  top: number;
  left: number;
  minWidth?: number;
  width?: number;
}

type FloatingMenuStyle = (CSSProperties & { '--floating-min-width'?: string }) | null;

const resolveViewportWidth = () => window.innerWidth || document.documentElement.clientWidth || 0;

const computeWidth = (anchorWidth: number, minWidth: number, matchAnchorWidth: boolean) => {
  if (matchAnchorWidth) {
    return Math.max(anchorWidth, minWidth);
  }
  return Math.max(minWidth || 0, anchorWidth || 0);
};

const formatStyle = (metrics: FloatingMenuMetrics | null): FloatingMenuStyle => {
  if (!metrics) {
    return null;
  }
  const style: FloatingMenuStyle = {
    position: metrics.strategy === 'absolute' ? 'absolute' : 'fixed',
    top: metrics.top,
    left: metrics.left,
  };
  if (metrics.minWidth != null) {
    style['--floating-min-width'] = `${Math.max(metrics.minWidth, 0)}px`;
  }
  if (metrics.width) {
    style.width = metrics.width;
  }
  return style;
};

interface UseFloatingMenuOptions {
  anchorRef?: MutableRefObject<HTMLElement | null>;
  offset?: number;
  minWidth?: number;
  matchAnchorWidth?: boolean;
  align?: 'start' | 'center' | 'end' | (string & {});
  viewportMargin?: number;
  onOpenChange?: (isOpen: boolean) => void;
  positionStrategy?: PositionStrategy;
}

const useFloatingMenu = ({
  anchorRef,
  offset = 6,
  minWidth = 0,
  matchAnchorWidth = false,
  align = 'start',
  viewportMargin = DEFAULT_VIEWPORT_MARGIN,
  onOpenChange,
  positionStrategy = 'fixed',
}: UseFloatingMenuOptions = {}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuMetrics, setMenuMetrics] = useState<FloatingMenuMetrics | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor) {
      return false;
    }

    const rect = anchor.getBoundingClientRect();
    const desiredWidth = computeWidth(rect.width, minWidth, matchAnchorWidth);
    const menu = menuRef.current;
    const measuredWidth = menu?.offsetWidth ?? desiredWidth;
    const widthForAlignment = matchAnchorWidth ? desiredWidth : Math.max(desiredWidth, measuredWidth);

    if (positionStrategy === 'absolute') {
      const anchor = anchorRef?.current;
      if (!anchor) {
        return false;
      }
      const offsetParent = (menu && menu.offsetParent) || anchor.offsetParent || anchor.parentElement;
      if (!offsetParent) {
        // Fall back to fixed positioning if we cannot resolve a relative parent.
        setMenuMetrics({
          strategy: 'fixed',
          top: rect.bottom + offset,
          left: rect.left,
          minWidth: desiredWidth,
          width: matchAnchorWidth ? desiredWidth : undefined,
        });
        return true;
      }

      let left;
      if (align === 'end') {
        left = anchor.offsetLeft + anchor.offsetWidth - widthForAlignment;
      } else if (align === 'center') {
        left = anchor.offsetLeft + anchor.offsetWidth / 2 - widthForAlignment / 2;
      } else {
        left = anchor.offsetLeft;
      }

      const top = anchor.offsetTop + anchor.offsetHeight + offset;

      setMenuMetrics({
        strategy: 'absolute',
        top,
        left,
        minWidth: desiredWidth,
        width: matchAnchorWidth ? desiredWidth : undefined,
      });
      return true;
    }

    const viewportWidth = resolveViewportWidth();
    const viewportHeight = window.innerHeight || 0;
    const safeMargin = viewportMargin ?? DEFAULT_VIEWPORT_MARGIN;
    const menuHeight = menu?.offsetHeight ?? 0;

    let left;
    if (align === 'end') {
      left = rect.right - widthForAlignment;
    } else if (align === 'center') {
      left = rect.left + rect.width / 2 - widthForAlignment / 2;
    } else {
      left = rect.left;
    }

    const maxLeft = viewportWidth > 0 ? viewportWidth - widthForAlignment - safeMargin : left;
    const clampedLeft = viewportWidth > 0 ? clamp(left, safeMargin, Math.max(maxLeft, safeMargin)) : left;

    let top = rect.bottom + offset;
    if (viewportHeight > 0 && menuHeight > 0) {
      const projectedBottom = top + menuHeight + safeMargin;
      if (projectedBottom > viewportHeight) {
        const upwardTop = rect.top - offset - menuHeight;
        top = Math.max(upwardTop, safeMargin);
      }
    }

    setMenuMetrics({
      strategy: 'fixed',
      top,
      left: clampedLeft,
      minWidth: desiredWidth,
      width: matchAnchorWidth ? desiredWidth : undefined,
    });

    return true;
  }, [
    anchorRef,
    align,
    matchAnchorWidth,
    minWidth,
    offset,
    positionStrategy,
    viewportMargin,
  ]);

  const close = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) {
        return prev;
      }
      onOpenChangeRef.current?.(false);
      return false;
    });
  }, []);

  const open = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) {
        return prev;
      }
      const positioned = updatePosition();
      if (!positioned) {
        onOpenChangeRef.current?.(false);
        return prev;
      }
      onOpenChangeRef.current?.(true);
      return true;
    });
  }, [updatePosition]);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) {
        onOpenChangeRef.current?.(false);
        return false;
      }
      const positioned = updatePosition();
      if (!positioned) {
        onOpenChangeRef.current?.(false);
        return prev;
      }
      onOpenChangeRef.current?.(true);
      return true;
    });
  }, [updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    let ignoreFocusEvents = true;
    const raf = window.requestAnimationFrame;
    const rafId = raf
      ? raf(() => {
        ignoreFocusEvents = false;
      })
      : null;

    if (!anchorRef?.current) {
      close();
      return undefined;
    }

    const handlePointer = (event) => {
      if (event.type === 'focusin' && ignoreFocusEvents) {
        return;
      }
      const target = event.target;
      // If the target is no longer in the document, it means it was unmounted
      // (e.g. due to a re-render caused by the open action).
      // In this case, we should ignore the event.
      if (target instanceof Node && !document.contains(target)) {
        return;
      }

      const menu = menuRef.current;
      const anchor = anchorRef?.current;

      if ((anchor && anchor.contains(target)) || (menu && menu.contains(target))) {
        return;
      }
      close();
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    // Delay adding listeners to avoid capturing the event that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handlePointer);
      document.addEventListener('touchstart', handlePointer, { passive: true });
      document.addEventListener('focusin', handlePointer);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('focusin', handlePointer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, close, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleRelayout = () => {
      const positioned = updatePosition();
      if (!positioned) {
        close();
      }
    };

    handleRelayout();
    window.addEventListener('resize', handleRelayout);
    window.addEventListener('scroll', handleRelayout, true);
    return () => {
      window.removeEventListener('resize', handleRelayout);
      window.removeEventListener('scroll', handleRelayout, true);
    };
  }, [close, isOpen, updatePosition]);

  return {
    isOpen,
    open,
    close,
    toggle,
    menuRef,
    menuStyle: formatStyle(menuMetrics),
    updatePosition,
  };
};

export default useFloatingMenu;
