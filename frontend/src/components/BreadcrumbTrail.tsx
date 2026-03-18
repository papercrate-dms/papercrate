import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import useFloatingMenu from './useFloatingMenu';
import {
  ELLIPSIS,
  WIDTH_BUFFER_RATIO,
  WIDTH_CHANGE_TOLERANCE,
  WIDTH_TOLERANCE,
} from '../constants/ui';

const normalizeEntries = (entries) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      if (!entry) {
        return null;
      }
      const id = entry.id ?? entry.value ?? index;
      const label = entry.label ?? entry.name ?? entry.title ?? '';
      const onClick = entry.onClick ? entry.onClick : null;
      return label ? { id, label, onClick, raw: entry } : null;
    })
    .filter(Boolean);

const BreadcrumbTrail = ({
  entries = [],
  className = '',
  separator = '/',
  truncateFromStart = true,
}) => {
  const normalized = useMemo(() => normalizeEntries(entries), [entries]);
  const shouldTruncateFromStart = truncateFromStart !== false;
  const measurementEntries = useMemo(
    () => (shouldTruncateFromStart ? normalized : normalized.slice().reverse()),
    [normalized, shouldTruncateFromStart],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measurementRef = useRef<HTMLDivElement | null>(null);
  const ellipsisButtonRef = useRef<HTMLButtonElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(null);
  const [startIndex, setStartIndex] = useState(0);
  const measureRafRef = useRef(null);

  const {
    isOpen: ellipsisMenuOpen,
    toggle: toggleEllipsisMenu,
    close: closeEllipsisMenu,
    menuRef: ellipsisMenuRef,
    menuStyle: ellipsisMenuStyle,
    updatePosition: refreshEllipsisMenuPosition,
  } = useFloatingMenu({
    anchorRef: ellipsisButtonRef,
    minWidth: 192,
    offset: 6,
  });

  useEffect(() => {
    closeEllipsisMenu();
  }, [normalized, shouldTruncateFromStart, closeEllipsisMenu]);

  useEffect(() => {
    const resolveHost = () => containerRef.current?.parentElement || containerRef.current;
    const measure = () => {
      const host = resolveHost();
      if (!host) {
        return;
      }
      const nextWidth = host.getBoundingClientRect().width;
      if (!nextWidth) {
        return;
      }
      setAvailableWidth((prev) => (
        prev && Math.abs(prev - nextWidth) < WIDTH_CHANGE_TOLERANCE ? prev : nextWidth
      ));
    };

    const scheduleMeasure = () => {
      const raf = window.requestAnimationFrame;
      if (!raf) {
        measure();
        return;
      }
      if (measureRafRef.current) {
        cancelAnimationFrame(measureRafRef.current);
      }
      measureRafRef.current = raf(() => {
        measureRafRef.current = null;
        measure();
      });
    };

    scheduleMeasure();

    if (!('ResizeObserver' in window)) {
      return () => {
        if (measureRafRef.current) {
          cancelAnimationFrame(measureRafRef.current);
          measureRafRef.current = null;
        }
      };
    }

    const host = resolveHost();
    if (!host) {
      return () => {
        if (measureRafRef.current) {
          cancelAnimationFrame(measureRafRef.current);
          measureRafRef.current = null;
        }
      };
    }

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (measureRafRef.current) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!measurementEntries.length) {
      return;
    }

    const container = containerRef.current;
    const measurement = measurementRef.current;
    const host = container?.parentElement || container;
    if (!container || !measurement || !host) {
      return;
    }

    const entryNodes = Array.from(
      measurement.querySelectorAll('[data-item-type="entry"]'),
    ) as HTMLElement[];
    if (!entryNodes.length) {
      return;
    }

    const separatorNodes = Array.from(
      measurement.querySelectorAll('[data-item-type="separator"]'),
    ) as HTMLElement[];
    const ellipsisNode = measurement.querySelector('[data-item-type="ellipsis"]') as HTMLElement | null;

    const originalEntryDisplay = entryNodes.map((node) => node.style.display);
    const originalSeparatorDisplay = separatorNodes.map((node) => node.style.display);
    const originalEllipsisDisplay = ellipsisNode ? ellipsisNode.style.display : null;

    const widths = [];

    for (let start = 0; start < entryNodes.length; start += 1) {
      entryNodes.forEach((node, index) => {
        // Hide entries that fall before the visible window.
        node.style.display = index < start ? 'none' : '';
      });

      separatorNodes.forEach((node) => {
        const targetIndex = Number(node.getAttribute('data-target-index'));
        node.style.display = targetIndex < Math.max(start, 1) ? 'none' : '';
      });

      if (ellipsisNode) {
        ellipsisNode.style.display = start > 0 ? '' : 'none';
      }

      widths[start] = measurement.getBoundingClientRect().width;
    }

    entryNodes.forEach((node, index) => {
      node.style.display = originalEntryDisplay[index] ?? '';
    });

    separatorNodes.forEach((node, index) => {
      node.style.display = originalSeparatorDisplay[index] ?? '';
    });

    if (ellipsisNode) {
      ellipsisNode.style.display = originalEllipsisDisplay ?? 'none';
    }

    const available = availableWidth ?? host.getBoundingClientRect().width;
    if (!available || !widths.length) {
      return;
    }

    // Reserve a tiny buffer so the live trail doesn't oscillate when the
    // container width barely fits; shrink the measured allowance a bit.
    const adjustedAvailable = available * WIDTH_BUFFER_RATIO;

    let nextStart = widths.length - 1;
    for (let start = 0; start < widths.length; start += 1) {
      if (widths[start] <= adjustedAvailable + WIDTH_TOLERANCE) {
        nextStart = start;
        break;
      }
    }

    if (nextStart !== startIndex) {
      setStartIndex(nextStart);
    }
  }, [measurementEntries, separator, availableWidth, startIndex]);

  const trimmedCount = Math.min(startIndex, Math.max(0, normalized.length - 1));
  const visibleEntries = shouldTruncateFromStart
    ? normalized.slice(trimmedCount)
    : normalized.slice(0, Math.max(normalized.length - trimmedCount, 1));
  const hiddenEntries = trimmedCount === 0
    ? []
    : shouldTruncateFromStart
      ? normalized.slice(0, trimmedCount)
      : normalized.slice(-trimmedCount);
  const hasHiddenEntries = hiddenEntries.length > 0;
  const ellipsisPlacement = shouldTruncateFromStart ? 'start' : 'end';
  const displayEntries = hasHiddenEntries
    ? ellipsisPlacement === 'start'
      ? [ELLIPSIS, ...visibleEntries]
      : [...visibleEntries, ELLIPSIS]
    : visibleEntries;

  useEffect(() => {
    if (!hasHiddenEntries) {
      closeEllipsisMenu();
      return;
    }
    if (ellipsisMenuOpen) {
      refreshEllipsisMenuPosition();
    }
  }, [
    hasHiddenEntries,
    ellipsisMenuOpen,
    closeEllipsisMenu,
    refreshEllipsisMenuPosition,
    hiddenEntries.length,
  ]);

  if (!normalized.length) {
    return null;
  }

  const wrapperClassName = className
    ? `breadcrumb-trail ${className}`.trim()
    : 'breadcrumb-trail';

  return (
    <>
      <span ref={containerRef} className={wrapperClassName}>
        {displayEntries.map((entry, index) => {
          const isEllipsis = entry.id === ELLIPSIS.id;
          const isLast = index === displayEntries.length - 1;

          if (isEllipsis) {
            return (
              <React.Fragment key="breadcrumb-ellipsis">
                {index > 0 ? (
                  <span className="breadcrumb-trail__separator" aria-hidden="true">
                    {separator}
                  </span>
                ) : null}
                <span className="breadcrumb-trail__ellipsis">
                  <button
                    ref={ellipsisButtonRef}
                    type="button"
                    className="breadcrumb-trail__link breadcrumb-trail__ellipsis-button"
                    aria-haspopup="menu"
                    aria-expanded={ellipsisMenuOpen}
                    onClick={() => {
                      if (!hasHiddenEntries) {
                        closeEllipsisMenu();
                        return;
                      }
                      toggleEllipsisMenu();
                    }}
                    title="Show parent folders"
                  >
                    {entry.label}
                  </button>
                </span>
              </React.Fragment>
            );
          }

          const commonProps = {
            className: `breadcrumb-trail__link${isLast ? ' is-current' : ''}`,
            title: entry.label,
            'aria-current': isLast ? 'page' : undefined,
          };

          const content = !entry.onClick || isLast
            ? (
              <span key={`${entry.id}-label`} {...commonProps}>
                {entry.label}
              </span>
            )
            : (
              <button
                key={`${entry.id}-button`}
                type="button"
                {...commonProps}
                onClick={() => entry.onClick?.(entry.raw ?? entry)}
              >
                {entry.label}
              </button>
            );

          return (
            <React.Fragment key={entry.id || index}>
              {index > 0 ? (
                <span className="breadcrumb-trail__separator" aria-hidden="true">
                  {separator}
                </span>
              ) : null}
              {content}
            </React.Fragment>
          );
        })}
      </span>
      <span
        ref={measurementRef}
        className="breadcrumb-trail breadcrumb-trail--measure"
        aria-hidden="true"
      >
        <button
          type="button"
          className="breadcrumb-trail__link breadcrumb-trail__ellipsis-button"
          data-item-type="ellipsis"
          style={{ display: 'none' }}
          tabIndex={-1}
        >
          {ELLIPSIS.label}
        </button>
        {measurementEntries.map((entry, index) => {
          const isLast = index === measurementEntries.length - 1;
          const isInteractive = Boolean(entry.onClick) && !isLast;
          const MeasurementTag = isInteractive ? 'button' : 'span';

          return (
            <React.Fragment key={`measure-${entry.id || index}`}>
              {index > 0 ? (
                <span
                  className="breadcrumb-trail__separator"
                  data-item-type="separator"
                  data-target-index={index}
                >
                  {separator}
                </span>
              ) : null}
              <MeasurementTag
                type={isInteractive ? 'button' : undefined}
                className="breadcrumb-trail__link"
                data-item-type="entry"
                data-entry-index={index}
                tabIndex={-1}
              >
                {entry.label}
              </MeasurementTag>
            </React.Fragment>
          );
        })}
      </span>
      {ellipsisMenuOpen
        && hasHiddenEntries
        && ellipsisMenuStyle
        ? createPortal(
          <div
            className="menu menu--floating"
            role="menu"
            ref={ellipsisMenuRef}
            style={ellipsisMenuStyle}
            data-floating-position
          >
            <div className="menu__list">
              {hiddenEntries.map((hiddenEntry) => (
                <button
                  key={hiddenEntry.id}
                  type="button"
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    closeEllipsisMenu();
                    hiddenEntry.onClick?.(hiddenEntry.raw ?? hiddenEntry);
                  }}
                  disabled={!hiddenEntry.onClick}
                >
                  <span className="menu__label">{hiddenEntry.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
};

export default BreadcrumbTrail;
