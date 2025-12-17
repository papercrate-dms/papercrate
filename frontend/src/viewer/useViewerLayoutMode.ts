import { MutableRefObject, useLayoutEffect, useState } from 'react';
import {
  DOCUMENT_VIEWER_PORTRAIT_HEIGHT_RATIO,
  MIN_STACKED_BREAKPOINT,
  PORTRAIT_RATIO_STYLE_ID,
} from '../constants/preview';

const ensurePortraitRatioStyle = () => {
  const cssValue = String(DOCUMENT_VIEWER_PORTRAIT_HEIGHT_RATIO);
  const cssText = `:root { --document-viewer-portrait-height-ratio: ${cssValue}; }`;

  let styleEl = document.getElementById(PORTRAIT_RATIO_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PORTRAIT_RATIO_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  if (styleEl.textContent !== cssText) {
    styleEl.textContent = cssText;
  }
};

const computeStackedLayoutBreakpoint = () => Math.max(window.innerWidth / 2, MIN_STACKED_BREAKPOINT);

export const useViewerLayoutMode = (
  ref: MutableRefObject<HTMLElement | null> | null,
  dependency?: unknown,
) => {
  const [isStacked, setIsStacked] = useState(false);

  useLayoutEffect(() => {
    ensurePortraitRatioStyle();
  }, []);

  useLayoutEffect(() => {
    const node = ref?.current;
    if (!node) {
      setIsStacked(false);
      return undefined;
    }

    let frame: number | null = null;
    const commitMeasure = (width: number) => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        const breakpoint = computeStackedLayoutBreakpoint();
        setIsStacked(width < breakpoint);
      });
    };

    const measure = () => {
      commitMeasure(node.getBoundingClientRect().width);
    };

    measure();

    const observer = new ResizeObserver((entries) => {
      if (!entries.length) {
        return;
      }
      commitMeasure(entries[0].contentRect.width);
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [ref, dependency]);

  return isStacked;
};
