import React, {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, JSX, MutableRefObject, RefObject } from 'react';
import {
  GlobalWorkerOptions,
  PasswordResponses,
  getDocument,
} from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api';
import {
  FAST_SCROLL_DWELL_THRESHOLD_MS,
  FAST_SCROLL_VELOCITY_THRESHOLD,
  MAX_PIXEL_RATIO,
  RERENDER_DELTA,
  SCROLL_VELOCITY_MIN_DELTA,
} from '../constants/preview';
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerProps {
  src: string;
  title?: string;
  className?: string;
  viewportRef?: RefObject<HTMLElement | null>;
}

type RenderStatus = 'idle' | 'loading' | 'ready' | 'error';
type ViewMode = 'fit-width' | 'contain';

interface PageDescriptor {
  number: number;
  width: number;
  height: number;
  scale: number;
}

interface RenderQueueRequest {
  pageNumber: number;
  resume: () => void;
  cancel: () => void;
}

const getAvailableViewportSize = (viewportNode: Element, stackNode: Element) => {
  const viewportStyle = window.getComputedStyle(viewportNode);
  const viewportPaddingX = parseFloat(viewportStyle.paddingLeft || '0')
    + parseFloat(viewportStyle.paddingRight || '0');
  const viewportPaddingY = parseFloat(viewportStyle.paddingTop || '0')
    + parseFloat(viewportStyle.paddingBottom || '0');

  const stackStyle = window.getComputedStyle(stackNode);
  const stackPaddingX = parseFloat(stackStyle.paddingLeft || '0')
    + parseFloat(stackStyle.paddingRight || '0');
  const stackPaddingY = parseFloat(stackStyle.paddingTop || '0')
    + parseFloat(stackStyle.paddingBottom || '0');

  const width = Math.max(0, viewportNode.clientWidth - viewportPaddingX - stackPaddingX);
  const height = Math.max(0, viewportNode.clientHeight - viewportPaddingY - stackPaddingY);
  return { width, height };
};

const resolvePdfWasmBaseUrl = (): string => {
  if (typeof document !== 'undefined') {
    const base = document.baseURI || (typeof window !== 'undefined' ? window.location.href : '/');
    return new URL('./pdfjs/wasm/', base).toString();
  }
  if (typeof window !== 'undefined' && window.location) {
    return new URL('./pdfjs/wasm/', window.location.href).toString();
  }
  return '/pdfjs/wasm/';
};

// ---------------------------------------------------------------------------
// PDF loading state — groups status, error, pages, and password state into
// a single reducer to reduce the number of useState calls.
// ---------------------------------------------------------------------------

interface PdfLoadingState {
  status: RenderStatus;
  errorMessage: string | null;
  pages: PageDescriptor[];
  isEncrypted: boolean;
  passwordError: boolean;
  passwordCallback: ((password: string) => void) | null;
}

type PdfLoadingAction =
  | { type: 'start' }
  | { type: 'ready'; pages: PageDescriptor[] }
  | { type: 'error'; message: string }
  | { type: 'password'; callback: (password: string) => void; incorrect: boolean };

const initialLoadingState: PdfLoadingState = {
  status: 'idle',
  errorMessage: null,
  pages: [],
  isEncrypted: false,
  passwordError: false,
  passwordCallback: null,
};

function pdfLoadingReducer(state: PdfLoadingState, action: PdfLoadingAction): PdfLoadingState {
  switch (action.type) {
    case 'start':
      return { ...initialLoadingState, status: 'loading' };
    case 'ready':
      return { ...state, status: 'ready', pages: action.pages, errorMessage: null };
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message };
    case 'password':
      return {
        ...state,
        isEncrypted: true,
        passwordCallback: action.callback,
        passwordError: action.incorrect,
      };
    default:
      return state;
  }
}

const PdfViewer = ({ src, title, className, viewportRef }: PdfViewerProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [renderWidth, setRenderWidth] = useState(0);
  const [loading, dispatchLoading] = useReducer(pdfLoadingReducer, initialLoadingState);
  const { status, errorMessage, pages, isEncrypted, passwordError, passwordCallback } = loading;
  const [pixelRatio, setPixelRatio] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('contain');
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const [scrollVelocity, setScrollVelocity] = useState(0);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const wasmUrlRef = useRef<string | null>(null);
  const pageNodeMapRef = useRef<Map<number, HTMLElement>>(new Map());
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const renderQueueRef = useRef<RenderQueueRequest[]>([]);
  const activeRendersRef = useRef(new Set<number>());
  const maxConcurrentRendersRef = useRef(2);
  const scrollVelocityRef = useRef({
    lastPosition: 0,
    lastTime: 0,
    velocity: 0,
  });
  const scrollElementRef = useRef<HTMLElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const requestQueueFlush = useCallback(() => {
    const queue = renderQueueRef.current;
    while (queue.length > 0 && activeRendersRef.current.size < maxConcurrentRendersRef.current) {
      const next = queue.pop();
      if (!next) {
        break;
      }
      if (activeRendersRef.current.has(next.pageNumber)) {
        next.cancel();
        continue;
      }
      activeRendersRef.current.add(next.pageNumber);
      next.resume();
    }
  }, []);

  const enqueueRender = useCallback((request: RenderQueueRequest) => {
    renderQueueRef.current.push(request);
    requestQueueFlush();
  }, [requestQueueFlush]);

  const releaseRenderSlot = useCallback((pageNumber: number) => {
    if (activeRendersRef.current.delete(pageNumber)) {
      requestQueueFlush();
    }
  }, [requestQueueFlush]);

  const cancelRenderRequest = useCallback((pageNumber: number) => {
    const queue = renderQueueRef.current;
    const index = queue.findIndex((entry) => entry.pageNumber === pageNumber);
    if (index >= 0) {
      const [entry] = queue.splice(index, 1);
      entry.cancel();
    }
    releaseRenderSlot(pageNumber);
  }, [releaseRenderSlot]);

  const handleRenderFinished = useCallback((pageNumber: number) => {
    releaseRenderSlot(pageNumber);
  }, [releaseRenderSlot]);
  const focusTargetRef = useRef<{
    ratioX: number;
    ratioY: number;
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);
  const ensureWasmUrl = useCallback(() => {
    if (!wasmUrlRef.current) {
      wasmUrlRef.current = resolvePdfWasmBaseUrl();
    }
    return wasmUrlRef.current;
  }, []);

  useLayoutEffect(() => {
    let frameId: number | null = null;
    let observer: ResizeObserver | null = null;

    const attach = () => {
      const stackElement = containerRef.current;
      const viewportElement = viewportRef?.current;
      const sizingElement = stackElement?.parentElement;

      if (!stackElement || !sizingElement) {
        frameId = requestAnimationFrame(attach);
        return;
      }

      const updateBounds = () => {
        const { width, height } = getAvailableViewportSize(sizingElement, stackElement);
        const nextWidth = Math.max(1, Math.round(width || 0));
        const nextHeight = Math.max(1, Math.round(height || 0));
        setViewportWidth((prev) => (prev === nextWidth ? prev : nextWidth));
        setViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
      };

      updateBounds();

      observer = new ResizeObserver(() => {
        updateBounds();
      });

      const observedNodes = new Set<Element>();
      const observeNode = (node: Element | null) => {
        if (!node || observedNodes.has(node)) {
          return;
        }
        observer?.observe(node);
        observedNodes.add(node);
      };

      observeNode(stackElement);
      observeNode(sizingElement);
      if (viewportElement) {
        observeNode(viewportElement);
      }
      observeNode(stackElement.closest('.document-viewer__viewport'));
    };

    attach();

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
    };
  }, [viewportRef]);

  useEffect(() => {
    if (viewportWidth <= 0) {
      return;
    }
    const desiredWidth = viewportWidth;
    setRenderWidth((current) => {
      if (current === 0 || desiredWidth > current + RERENDER_DELTA) {
        return desiredWidth;
      }
      return current;
    });
  }, [viewportWidth]);

  useEffect(() => {
    const focus = focusTargetRef.current;
    if (!focus) {
      return;
    }
    const viewportElement = viewportRef?.current || containerRef.current?.closest('.document-viewer__viewport');
    const stackElement = containerRef.current;
    if (!viewportElement || !stackElement) {
      focusTargetRef.current = null;
      return;
    }
    const contentWidth = Math.max(1, stackElement.scrollWidth || stackElement.clientWidth);
    const contentHeight = Math.max(1, stackElement.scrollHeight || stackElement.clientHeight);
    const targetX = focus.ratioX * contentWidth;
    const targetY = focus.ratioY * contentHeight;
    const nextScrollLeft = Math.max(0, targetX - focus.pointerOffsetX);
    const nextScrollTop = Math.max(0, targetY - focus.pointerOffsetY);
    viewportElement.scrollTo({
      left: nextScrollLeft,
      top: nextScrollTop,
      behavior: 'auto',
    });
    focusTargetRef.current = null;
  }, [viewMode, viewportRef]);

  // Auto-detect scrollbar contrast requirement
  useEffect(() => {
    const viewportElement = viewportRef?.current || containerRef.current?.closest('.document-viewer__viewport');
    if (!viewportElement || pages.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
      return;
    }

    const page = pages[0];
    const pageAspect = page.width / page.height;
    const viewportAspect = viewportWidth / viewportHeight;

    // If we are in 'fit-width' mode, the page usually covers the full width (white background).
    // If we are in 'contain' mode, we check if the page is narrower than the viewport (gray background).
    const hasHorizontalMargin = viewMode === 'contain' && pageAspect < viewportAspect;

    // If there is no margin (white page), we need the light scheme (dark scrollbar).
    // If there is a margin (gray background), we use the default scheme (light scrollbar).
    if (!hasHorizontalMargin) {
      viewportElement.classList.add('document-viewer__viewport--light-scheme');
    } else {
      viewportElement.classList.remove('document-viewer__viewport--light-scheme');
    }

    return () => {
      viewportElement.classList.remove('document-viewer__viewport--light-scheme');
    };
  }, [viewMode, viewportRef, pages, viewportWidth, viewportHeight]);

  useEffect(() => {
    if (!src || renderWidth <= 0) {
      return undefined;
    }

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let activePdf: PDFDocumentProxy | null = null;
    const wasmUrl = ensureWasmUrl();

    const disposeActivePdf = () => {
      if (activePdf) {
        void activePdf.destroy();
        if (pdfRef.current === activePdf) {
          pdfRef.current = null;
        }
        activePdf = null;
      }
    };

    if (pdfRef.current) {
      void pdfRef.current.destroy();
      pdfRef.current = null;
    }

    dispatchLoading({ type: 'start' });
    const renderDocument = async () => {
      try {
        loadingTask = getDocument({
          url: src,
          wasmUrl,
        });
        loadingTask.onPassword = (callback, reason) => {
          dispatchLoading({
            type: 'password',
            callback,
            incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
          });
        };

        const pdf = await loadingTask.promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }

        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const descriptors: PageDescriptor[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            break;
          }
          const page = await pdf.getPage(pageNumber);
          if (cancelled) {
            break;
          }
          const baseViewport = page.getViewport({ scale: 1 });
          const desiredScale = Math.max(0.5, renderWidth / baseViewport.width);
          const viewport = page.getViewport({ scale: desiredScale });
          descriptors.push({
            number: pageNumber,
            width: viewport.width,
            height: viewport.height,
            scale: desiredScale,
          });
        }

        if (cancelled) {
          await pdf.destroy();
          return;
        }

        activePdf = pdf;
        pdfRef.current = pdf;
        setPixelRatio(ratio);
        dispatchLoading({ type: 'ready', pages: descriptors });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to prepare PDF preview', error);
          dispatchLoading({ type: 'error', message: 'Unable to render PDF preview.' });
        }
      }
    };

    renderDocument().catch((error) => {
      console.error('Unhandled PDF render error', error);
      dispatchLoading({ type: 'error', message: 'Unable to render PDF preview.' });
    });

    return () => {
      cancelled = true;
      loadingTask?.destroy();
      disposeActivePdf();
    };
  }, [ensureWasmUrl, renderWidth, src]);

  const handlePasswordSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    if (passwordCallback && passwordInputRef.current) {
      passwordCallback(passwordInputRef.current.value);
    }
  }, [passwordCallback]);

  const viewerClasses = ['document-viewer__object', 'document-viewer__object--pdf', className]
    .filter(Boolean)
    .join(' ');
  const statusMessage = status === 'error'
    ? (errorMessage || 'Unable to render PDF preview.')
    : 'Preparing preview…';
  const statusClasses = ['pdf-viewer__status', status === 'error' ? 'pdf-viewer__status--error' : null]
    .filter(Boolean)
    .join(' ');
  const showStatus = status !== 'ready' || pages.length === 0;
  const stackStyle = useMemo<CSSProperties>(() => ({
    '--pdf-viewer-viewport-width': `${viewportWidth}px`,
    '--pdf-viewer-viewport-height': `${viewportHeight}px`,
  }), [viewportHeight, viewportWidth]);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'fit-width' ? 'contain' : 'fit-width'));
  }, []);

  const handlePageClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest('.pdf-viewer__page-wrapper')) {
      return;
    }

    const stack = containerRef.current;
    const viewportElement = viewportRef?.current || stack?.closest('.document-viewer__viewport');
    if (stack && viewportElement) {
      const viewportRect = viewportElement.getBoundingClientRect();
      const pointerOffsetX = event.clientX - viewportRect.left;
      const pointerOffsetY = event.clientY - viewportRect.top;
      const contentWidth = Math.max(1, stack.scrollWidth || stack.clientWidth);
      const contentHeight = Math.max(1, stack.scrollHeight || stack.clientHeight);
      const ratioX = (viewportElement.scrollLeft + pointerOffsetX) / contentWidth;
      const ratioY = (viewportElement.scrollTop + pointerOffsetY) / contentHeight;
      focusTargetRef.current = {
        ratioX: Math.max(0, Math.min(1, ratioX)),
        ratioY: Math.max(0, Math.min(1, ratioY)),
        pointerOffsetX: Math.max(0, Math.min(viewportElement.clientWidth, pointerOffsetX)),
        pointerOffsetY: Math.max(0, Math.min(viewportElement.clientHeight, pointerOffsetY)),
      };
    }
    event.stopPropagation();
    toggleViewMode();
  }, [toggleViewMode, viewportRef]);

  const handlePageVisibilityChange = useCallback((pageNumber: number, isVisible: boolean) => {
    setVisiblePages((prev) => {
      const alreadyVisible = prev.has(pageNumber);
      if (alreadyVisible === isVisible) {
        return prev;
      }
      const next = new Set(prev);
      if (isVisible) {
        next.add(pageNumber);
      } else {
        next.delete(pageNumber);
      }
      return next;
    });
  }, []);

  const shouldRenderPage = useCallback((pageNumber: number) => {
    if (visiblePages.size === 0) {
      return pageNumber === 1;
    }
    for (const visiblePage of visiblePages) {
      if (Math.abs(visiblePage - pageNumber) <= 2) {
        return true;
      }
    }
    return false;
  }, [visiblePages]);

  const intersectionRoot = viewportRef?.current || null;

  const updateScrollVelocityState = useCallback((nextVelocity: number) => {
    setScrollVelocity((previous) => {
      const wasFast = Math.abs(previous) > FAST_SCROLL_VELOCITY_THRESHOLD;
      const isFast = Math.abs(nextVelocity) > FAST_SCROLL_VELOCITY_THRESHOLD;
      if (!isFast && !wasFast && Math.abs(previous - nextVelocity) < SCROLL_VELOCITY_MIN_DELTA) {
        return previous;
      }
      if (Math.abs(previous - nextVelocity) < SCROLL_VELOCITY_MIN_DELTA && wasFast === isFast) {
        return previous;
      }
      return nextVelocity;
    });
  }, []);

  const registerPageNode = useCallback((pageNumber: number, node: HTMLElement | null) => {
    const map = pageNodeMapRef.current;
    const existing = map.get(pageNumber);
    if (existing === node) {
      return;
    }
    if (existing) {
      intersectionObserverRef.current?.unobserve(existing);
      map.delete(pageNumber);
    }
    if (node) {
      node.dataset.pageNumber = String(pageNumber);
      map.set(pageNumber, node);
      intersectionObserverRef.current?.observe(node);
    }
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    let observer: IntersectionObserver | null = null;
    let scrollElement: HTMLElement | null = null;
    let scrollListener: (() => void) | null = null;

    const attachObserver = () => {
      const stackElement = containerRef.current;
      if (!stackElement) {
        frame = requestAnimationFrame(attachObserver);
        return;
      }
      const root = intersectionRoot
        || stackElement.closest('.document-viewer__viewport')
        || undefined;
      scrollElement = (viewportRef?.current || stackElement.closest('.document-viewer__viewport')) ?? null;
      scrollElementRef.current = scrollElement;
      if (scrollElement && !scrollListener) {
        scrollVelocityRef.current = {
          lastPosition: scrollElement.scrollTop,
          lastTime: performance.now(),
          velocity: 0,
        };
        scrollListener = () => {
          if (!scrollElement) {
            return;
          }
          const now = performance.now();
          const position = scrollElement.scrollTop;
          const elapsed = now - scrollVelocityRef.current.lastTime;
          if (elapsed <= 0) {
            return;
          }
          const velocity = (position - scrollVelocityRef.current.lastPosition) / elapsed;
          scrollVelocityRef.current = {
            lastPosition: position,
            lastTime: now,
            velocity,
          };
          updateScrollVelocityState(velocity);
        };
        scrollElement.addEventListener('scroll', scrollListener, { passive: true });
      }
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const attr = entry.target.getAttribute('data-page-number');
          if (!attr) {
            return;
          }
          const pageNumber = Number(attr);
          if (!(pageNumber > 0)) {
            return;
          }
          handlePageVisibilityChange(pageNumber, entry.isIntersecting);
        });
      }, {
        root: root as Element | undefined,
        rootMargin: '200px 0px',
        threshold: 0.1,
      });
      intersectionObserverRef.current = observer;
      pageNodeMapRef.current.forEach((node) => observer?.observe(node));
    };

    attachObserver();

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      if (intersectionObserverRef.current === observer) {
        intersectionObserverRef.current = null;
      }
      if (scrollElement && scrollListener) {
        scrollElement.removeEventListener('scroll', scrollListener);
      }
      if (scrollElementRef.current === scrollElement) {
        scrollElementRef.current = null;
      }
    };
  }, [handlePageVisibilityChange, intersectionRoot, updateScrollVelocityState, viewMode, viewportRef]);

  const pageElements = useMemo(() => (
    pages.map((page) => (
      <Fragment key={`${page.number}-${Math.round(page.scale * 100)}-${Math.round(pixelRatio * 100)}`}>
        <PdfPageCanvas
          descriptor={page}
          pdfRef={pdfRef}
          pixelRatio={pixelRatio}
          onPageClick={handlePageClick}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
          viewMode={viewMode}
          shouldRender={shouldRenderPage(page.number)}
          registerPageNode={registerPageNode}
          enqueueRender={enqueueRender}
          cancelRenderRequest={cancelRenderRequest}
          onRenderFinished={handleRenderFinished}
          scrollVelocity={scrollVelocity}
        />
      </Fragment>
    ))
  ), [cancelRenderRequest, enqueueRender, handlePageClick, handleRenderFinished,
    pages, pixelRatio, registerPageNode, scrollVelocity, shouldRenderPage, viewportHeight, viewportWidth,
    viewMode]);

  return (
    <div className={viewerClasses}>
      {isEncrypted && !pdfRef.current ? (
        <div
          className="pdf-viewer__password-container"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <form onSubmit={handlePasswordSubmit} className="pdf-viewer__password-form">
            <div className="pdf-viewer__password-message">
              This document is password protected.
            </div>
            <div className="pdf-viewer__password-input-group">
              <input
                ref={passwordInputRef}
                type="password"
                className="pdf-viewer__password-input"
                placeholder="Enter password"
                autoFocus
              />
              <button type="submit" className="button button--primary">
                Unlock
              </button>
            </div>
            {passwordError ? (
              <div className="pdf-viewer__password-error">
                Incorrect password. Please try again.
              </div>
            ) : null}
          </form>
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            className={`pdf-viewer__canvas-stack pdf-viewer__canvas-stack--${viewMode}`}
            role="document"
            aria-label={title || 'PDF document'}
            style={stackStyle}
          >
            {pageElements}
          </div>
          {showStatus ? (
            <div className={statusClasses}>
              <div className="document-viewer__message">
                {statusMessage}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

interface PdfPageCanvasProps {
  descriptor: PageDescriptor;
  pdfRef: MutableRefObject<PDFDocumentProxy | null>;
  pixelRatio: number;
  onPageClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  viewportWidth: number;
  viewportHeight: number;
  viewMode: ViewMode;
  shouldRender: boolean;
  registerPageNode: (pageNumber: number, node: HTMLElement | null) => void;
  enqueueRender: (request: RenderQueueRequest) => void;
  cancelRenderRequest: (pageNumber: number) => void;
  onRenderFinished: (pageNumber: number) => void;
  scrollVelocity: number;
}

function PdfPageCanvas({
  descriptor,
  pdfRef,
  pixelRatio,
  onPageClick,
  viewportWidth,
  viewportHeight,
  viewMode,
  shouldRender,
  registerPageNode,
  enqueueRender,
  cancelRenderRequest,
  onRenderFinished,
  scrollVelocity,
}: PdfPageCanvasProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const hasRenderedRef = useRef(false);
  const setWrapperNode = useCallback((node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    registerPageNode(descriptor.number, node);
  }, [descriptor.number, registerPageNode]);
  const [canvasMounted, setCanvasMounted] = useState(false);
  const [allowRender, setAllowRender] = useState(false);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = 0;
    canvas.height = 0;
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, context.canvas.width || 0, context.canvas.height || 0);
  }, []);

  const renderPage = useCallback(async () => {
    if (renderTaskRef.current || hasRenderedRef.current) {
      return;
    }
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) {
      onRenderFinished(descriptor.number);
      return;
    }
    try {
      const page = await pdf.getPage(descriptor.number);
      const viewport = page.getViewport({ scale: descriptor.scale });
      const qualityScale = 1;
      const renderContext = canvas.getContext('2d');
      if (!renderContext) {
        return;
      }

      canvas.width = viewport.width * pixelRatio * qualityScale;
      canvas.height = viewport.height * pixelRatio * qualityScale;
      renderContext.setTransform(pixelRatio * qualityScale, 0, 0, pixelRatio * qualityScale, 0, 0);

      const renderTask = page.render({
        canvasContext: renderContext,
        viewport,
        canvas,
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      hasRenderedRef.current = true;

      page.cleanup();

      const wrapper = wrapperRef.current;
      if (wrapper) {
        wrapper.querySelector('.textLayer')?.remove();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'RenderingCancelledException') {
        return;
      }
      console.error('Failed to render PDF page', descriptor.number, error);
    } finally {
      renderTaskRef.current = null;
      onRenderFinished(descriptor.number);
    }
  }, [descriptor.number, descriptor.scale, onRenderFinished, pdfRef, pixelRatio]);

  const meetsVelocityRequirement = useMemo(() => {
    if (!shouldRender) {
      return true;
    }
    const absoluteVelocity = Math.abs(scrollVelocity);
    if (absoluteVelocity <= FAST_SCROLL_VELOCITY_THRESHOLD) {
      return true;
    }
    const estimatedMs = (descriptor.height + viewportHeight)
      / Math.max(absoluteVelocity, 0.001);
    return estimatedMs >= FAST_SCROLL_DWELL_THRESHOLD_MS;
  }, [descriptor.height, scrollVelocity, shouldRender, viewportHeight]);

  useEffect(() => {
    if (!canvasMounted) {
      return undefined;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    canvas.width = descriptor.width;
    canvas.height = descriptor.height;
    canvas.style.setProperty('aspect-ratio', `${descriptor.width} / ${descriptor.height}`);
    const wrapperNode = wrapperRef.current;
    return () => {
      renderTaskRef.current?.cancel();
      wrapperNode?.querySelector('.textLayer')?.remove();
    };
  }, [canvasMounted, descriptor.height, descriptor.width]);

  useEffect(() => {
    setCanvasMounted(false);
    hasRenderedRef.current = false;
    renderTaskRef.current?.cancel();
    resetCanvas();
  }, [descriptor.number, resetCanvas]);

  useEffect(() => {
    if (!shouldRender || !meetsVelocityRequirement) {
      setAllowRender(false);
      cancelRenderRequest(descriptor.number);
      return;
    }
    let cancelled = false;
    const request: RenderQueueRequest = {
      pageNumber: descriptor.number,
      resume: () => {
        if (cancelled) {
          return;
        }
        setAllowRender(true);
      },
      cancel: () => {
        cancelled = true;
        setAllowRender(false);
      },
    };
    enqueueRender(request);
    return () => {
      cancelled = true;
      setAllowRender(false);
      cancelRenderRequest(descriptor.number);
    };
  }, [cancelRenderRequest, descriptor.number, enqueueRender, meetsVelocityRequirement, shouldRender]);

  useEffect(() => {
    if (allowRender) {
      setCanvasMounted((prev) => (prev ? prev : true));
      return;
    }
    setCanvasMounted((prev) => {
      if (!prev) {
        return prev;
      }
      hasRenderedRef.current = false;
      renderTaskRef.current?.cancel();
      wrapperRef.current?.querySelector('.textLayer')?.remove();
      resetCanvas();
      return false;
    });
  }, [allowRender, resetCanvas]);

  useEffect(() => {
    if (!canvasMounted || !allowRender) {
      return;
    }
    void renderPage();
  }, [allowRender, canvasMounted, renderPage]);

  const limitAxis: 'width' | 'height' = useMemo(() => {
    if (viewMode === 'fit-width') {
      return 'width';
    }
    const safeViewportWidth = Math.max(1, viewportWidth);
    const safeViewportHeight = Math.max(1, viewportHeight);
    const safePageWidth = Math.max(1, descriptor.width);
    const safePageHeight = Math.max(1, descriptor.height);
    const widthScale = safeViewportWidth / safePageWidth;
    const heightScale = safeViewportHeight / safePageHeight;
    return widthScale <= heightScale ? 'width' : 'height';
  }, [descriptor.height, descriptor.width, viewMode, viewportHeight, viewportWidth]);

  const wrapperClassName = useMemo(() => (
    ['pdf-viewer__page-wrapper',
      limitAxis === 'width' ? 'pdf-viewer__page-wrapper--limit-width' : 'pdf-viewer__page-wrapper--limit-height',
    ].filter(Boolean).join(' ')
  ), [limitAxis]);

  return (
    <div
      ref={setWrapperNode}
      className={wrapperClassName}
      data-page-number={descriptor.number}
      style={{
        aspectRatio: `${descriptor.width} / ${descriptor.height}`,
        '--pdf-viewer-page-width': `${descriptor.width}px`,
        '--pdf-viewer-page-height': `${descriptor.height}px`,
        '--pdf-viewer-page-aspect': `${descriptor.width / descriptor.height}`,
      }}
      onClick={(event) => {
        onPageClick(event);
      }}
    >
      {canvasMounted ? (
        <canvas
          ref={canvasRef}
          className="pdf-viewer__page"
          aria-label={`Page ${descriptor.number}`}
        />
      ) : null}
    </div>
  );
}

export default PdfViewer;
