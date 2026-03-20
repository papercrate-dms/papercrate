import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Character-count threshold above which we switch from a plain <pre> to
 * virtualised line rendering.
 */
const VIRTUALIZE_THRESHOLD = 10_000;

const LINE_HEIGHT = 22;
const OVERSCAN = 30;

interface VirtualizedTextViewerProps {
  text: string;
  className?: string;
}

const VirtualizedTextViewer: React.FC<VirtualizedTextViewerProps> = ({
  text,
  className = '',
}) => {
  if (text.length < VIRTUALIZE_THRESHOLD) {
    return <pre className={className}>{text}</pre>;
  }

  return <VirtualizedContent text={text} className={className} />;
};

const VirtualizedContent: React.FC<VirtualizedTextViewerProps> = ({
  text,
  className,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  const lines = useMemo(() => text.split('\n'), [text]);
  const totalHeight = lines.length * LINE_HEIGHT;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const end = Math.min(lines.length, start + Math.ceil(height / LINE_HEIGHT) + 2 * OVERSCAN);

  const cls = className
    ? `${className} document-viewer__object--text-content--virtualized`
    : 'document-viewer__object--text-content--virtualized';

  return (
    <div
      ref={ref}
      className={cls}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div
        className="document-viewer__object--text-content--virtualized__sentinel"
        style={{ height: totalHeight }}
      >
        <div
          className="document-viewer__object--text-content--virtualized__window"
          style={{ top: start * LINE_HEIGHT }}
        >
          {lines.slice(start, end).map((line, i) => (
            <div key={start + i}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VirtualizedTextViewer;
