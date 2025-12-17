import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, MutableRefObject } from 'react';
import type { Document } from '../types/documents';
import {
  getAssetFromVersion,
  resolveDocumentAssetUrl,
  resolveAssetUrl,
} from '../lib/assets/AssetManager';
import { DEFAULT_THUMBNAIL_SIZE } from '../constants/documents';
import type {
  Asset as AssetManagerAsset,
  EnsureAssetUrl as AssetManagerEnsureAssetUrl,
  GetAsset as AssetManagerGetAsset,
} from '../lib/assets/AssetManager';

// Detect when an element becomes visible within a scroll container so we can delay loading.
const useLazyVisibility = (
  rootRef: MutableRefObject<Element | null> | null,
  resetKey?: string | null,
) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(false);
  }, [resetKey]);

  const rootNode = rootRef?.current || null;

  useEffect(() => {
    if (isVisible) {
      return undefined;
    }

    const element = targetRef.current;
    if (!element) {
      return undefined;
    }

    if (!window.IntersectionObserver) {
      setIsVisible(true);
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      {
        root: rootNode,
        rootMargin: '200px 0px',
        threshold: 0.01,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isVisible, rootNode, resetKey]);

  return { ref: targetRef, isVisible };
};



const getPageCount = (doc?: Document | null): number | null => {
  return doc?.current_version?.metadata?.page_count;
};

type Asset = AssetManagerAsset;
type EnsureAssetUrl = AssetManagerEnsureAssetUrl;
type GetAsset = AssetManagerGetAsset;

interface DocumentThumbnailImageProps {
  document?: Document | null;
  ensureAssetUrl?: EnsureAssetUrl;
  getAsset?: GetAsset;
  alt?: string;
  maxSize?: number;
  scrollRootRef?: MutableRefObject<Element | null> | null;
}

const DocumentThumbnailImage = ({
  document,
  ensureAssetUrl,
  getAsset,
  alt = '',
  maxSize = DEFAULT_THUMBNAIL_SIZE,
  scrollRootRef = null,
}: DocumentThumbnailImageProps): JSX.Element => {
  const documentId = document?.id;
  const { ref: visibilityRef, isVisible } = useLazyVisibility(scrollRootRef, documentId);
  const resolvedMaxSize = Math.max(1, Math.round(maxSize || 1));

  const thumbnailAsset = useMemo<Asset | null>(
    () => getAssetFromVersion(document?.current_version, 'thumbnail'),
    [document?.current_version],
  );
  const thumbnailMetadata = (thumbnailAsset?.metadata as { width?: number; height?: number } | null) || null;
  const assetWidth = thumbnailMetadata?.width;
  const assetHeight = thumbnailMetadata?.height;

  const dimensions = useMemo(() => {
    const hasDimensions = typeof assetWidth === 'number' && assetWidth > 0 && typeof assetHeight === 'number' && assetHeight > 0;
    if (!hasDimensions) {
      return { width: resolvedMaxSize, height: resolvedMaxSize };
    }
    const scale = Math.min(1, resolvedMaxSize / assetWidth, resolvedMaxSize / assetHeight);
    return {
      width: Math.max(1, Math.round(assetWidth * scale)),
      height: Math.max(1, Math.round(assetHeight * scale)),
    };
  }, [assetWidth, assetHeight, resolvedMaxSize]);

  const innerStyle = useMemo<CSSProperties>(
    () => ({ width: `${dimensions.width}px`, height: `${dimensions.height}px` }),
    [dimensions.height, dimensions.width],
  );

  const url = useMemo(() => {
    if (!isVisible) {
      return null;
    }
    const options: {
      ensureAssetUrl?: EnsureAssetUrl;
      getAsset?: GetAsset;
    } = {};
    if (ensureAssetUrl) {
      options.ensureAssetUrl = ensureAssetUrl;
    }
    if (getAsset) {
      options.getAsset = getAsset;
    }
    return resolveDocumentAssetUrl(document, 'thumbnail', options) || resolveAssetUrl(thumbnailAsset);
  }, [document, ensureAssetUrl, getAsset, isVisible, thumbnailAsset]);

  const pageCount = getPageCount(document);
  const showMultiPageBadge = pageCount !== null && pageCount > 1;
  const innerClasses = ['document-thumbnail-inner'];
  if (showMultiPageBadge) {
    innerClasses.push('document-thumbnail-inner--multipage');
  }

  const aspectRatio = useMemo(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      return dimensions.width / dimensions.height;
    }
    return null;
  }, [dimensions.height, dimensions.width]);

  useEffect(() => {
    const node = visibilityRef.current;
    if (!node) {
      return;
    }
    if (aspectRatio) {
      node.dataset.thumbnailAspect = String(aspectRatio);
    } else {
      delete node.dataset.thumbnailAspect;
    }
  }, [aspectRatio, visibilityRef]);

  return (
    <div className="document-thumbnail-wrapper" ref={visibilityRef}>
      <div className={innerClasses.join(' ')} style={innerStyle}>
        {url ? (
          <img
            src={url}
            alt={alt}
            className="document-thumbnail"
            loading="lazy"
            decoding="async"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
          />
        ) : (
          <div className="thumb-placeholder">DOC</div>
        )}
      </div>
    </div>
  );
};

export default DocumentThumbnailImage;
