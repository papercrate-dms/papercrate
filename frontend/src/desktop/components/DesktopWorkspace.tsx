import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LayoutStore, LayoutCard } from '../logic/LayoutSystem';
import DesktopDocumentCard from './DesktopDocumentCard';
import usePreviewMetadata from '../hooks/usePreviewMetadata';
import {
  TagInteractionHandlers,
} from '../../documents/interactions/useTagInteractions';
import './workspace-layout.css';
import './workspace-items.css';
import './workspace-cards.css';
import { useWorkspaceSelectionContext } from '../../app/WorkspaceSelectionContext';
import { createDocumentEntryKey } from '../../app/entryKey';
import { PointerTrackingProvider, usePointerTracking } from '../interactions/PointerTrackingContext';
import type { Identifier } from '../../types/identifiers';
import type { DocumentsListEntry, Document } from '../../types/documents';
import { useAppState } from '../../lib/store/appState';
import { useDocumentOpen } from '../../lib/context/DocumentOpenContext';
import { useDocumentsAssetContext } from '../../documents/context/DocumentsAssetContext';
import { useDocumentsViewStateContext } from '../../documents/context/DocumentsViewStateContext';

interface DocumentSizeInfo {
  width: number;
  height: number;
  source?: 'snapshot' | 'metadata' | 'fallback';
}

// Fallback size computation
const computeFallbackCardSize = (_doc: Document, defaultSize: number = 200): DocumentSizeInfo => {
  const size = Math.round(defaultSize * (1 / Math.SQRT2));
  return { width: size, height: size, source: 'fallback' };
};

interface DesktopWorkspaceProps {
  entries: DocumentsListEntry[];
  onSelectionChange?: (selectedIds: Identifier[]) => void;
  viewId?: string | null;
  defaultCardSize?: number;
  tagHandlers?: TagInteractionHandlers;
}

const DesktopWorkspaceContent: React.FC<DesktopWorkspaceProps> = ({
  entries,
  onSelectionChange,
  viewId,
  defaultCardSize = 200,
  tagHandlers,
}) => {
  const { openDocument } = useDocumentOpen();
  const {
    ensureAssetUrl,
    getDocumentAsset
  } = useDocumentsAssetContext();

  const { tenant } = useAppState();
  const tenantId = tenant?.id as Identifier;
  const { addPointer, removePointer } = usePointerTracking();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const [isLayoutLoaded, setIsLayoutLoaded] = useState(false);
  const [hasContainerSize, setHasContainerSize] = useState(false);

  const items = useMemo(() => {
    return entries
      .filter((entry): entry is { type: 'document'; document: Document } & DocumentsListEntry =>
        entry.type === 'document' && !!entry.document
      )
      .map(entry => entry.document);
  }, [entries]);

  // Layout System Initialization
  const layoutStore = useMemo(() => new LayoutStore(), []);
  const layoutRef = useRef<Map<string, LayoutCard>>(new Map());

  // Update container size in store
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        layoutStore.setContainerSize(width, height);
        if (width > 0 && height > 0) {
          setHasContainerSize(true);
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [layoutStore]);

  useEffect(() => {
    if (tenantId && viewId) {
      // Clear store when switching views to prevent stale items
      layoutStore.clear();
      setIsLayoutLoaded(false);
      setIsLayoutReady(false); // Immediately hide cards during transition
      layoutStore.loadLayout(String(tenantId), viewId).then(() => {
        setIsLayoutLoaded(true);
      });
    } else {
      // No tenant/view ID means no saved layout to load - skip directly to loaded
      setIsLayoutLoaded(true);
    }
  }, [layoutStore, tenantId, viewId]);

  const metadataMap = usePreviewMetadata(items, getDocumentAsset, ensureAssetUrl);

  const ensureDocumentSize = useCallback((doc: Document): DocumentSizeInfo => {
    if (doc.id) {
      const meta = metadataMap.get(String(doc.id));
      if (meta && meta.width && meta.height)
        return { width: meta.width, height: meta.height, source: 'metadata' };
    }

    return computeFallbackCardSize(doc, defaultCardSize);
  }, [metadataMap, defaultCardSize]);

  // Synchronize LayoutStore with current items (Initialization & Cleanup)
  useEffect(() => {
    if (!hasContainerSize || !isLayoutLoaded) return;

    // Cleanup Stale Items
    const currentIds = new Set(items.map((doc, index) => doc.id ? String(doc.id) : `temp-${index}`));
    for (const id of layoutStore.items.keys()) {
      if (!currentIds.has(id)) {
        layoutStore.unregister(id);
      }
    }

    // Initialize / Update Items (Saved first, then others)
    const itemsWithSavedLayout: Document[] = [];
    const itemsWithoutSavedLayout: Document[] = [];

    items.forEach(doc => {
      // If already initialized in store, we don't strictly need to prioritize it for collision, 
      // but keeping the order ensures consistent behavior on re-runs.
      // However, usually we only care about *new* items for collision logic.
      if (doc.id && layoutStore.hasSavedLayout(String(doc.id))) {
        itemsWithSavedLayout.push(doc);
      } else {
        itemsWithoutSavedLayout.push(doc);
      }
    });

    const initializeDoc = (doc: Document) => {
      const size = ensureDocumentSize(doc);
      const metadata = doc.current_version?.metadata as { page_count?: number } | undefined;
      const pageCount = metadata?.page_count ?? 1;

      layoutStore.initialize(doc.id, null, {
        width: size.width,
        height: size.height,
        pageCount,
        maxSize: defaultCardSize
      });
    };

    itemsWithSavedLayout.forEach(initializeDoc);
    itemsWithoutSavedLayout.forEach(initializeDoc);

    // Save newly placed items
    if (itemsWithoutSavedLayout.length > 0) {
      void layoutStore.saveLayout();
    }

    // Enforce constraints
    layoutStore.relayout();

    setIsLayoutReady(true);
  }, [hasContainerSize, isLayoutLoaded, items, layoutStore, ensureDocumentSize, defaultCardSize]);

  // Selection Context
  const {
    selectedDocumentIds,
    setSelectedEntries,
    clearSelection,
  } = useWorkspaceSelectionContext();

  const handleSelectionChange = useCallback((ids: Identifier[]) => {
    // Sort IDs by Z-index (ascending) so the last item is the top-most
    const sortedIds = [...ids].sort((a, b) => {
      const cardA = layoutStore.items.get(String(a));
      const cardB = layoutStore.items.get(String(b));
      const zA = cardA ? cardA.z : -Infinity;
      const zB = cardB ? cardB.z : -Infinity;
      return zA - zB;
    });

    if (setSelectedEntries) {
      const keys = sortedIds.map(id => createDocumentEntryKey(id));
      setSelectedEntries(keys);
    }
    onSelectionChange?.(sortedIds);
  }, [setSelectedEntries, onSelectionChange, layoutStore]);

  const onClearSelection = useCallback(() => {
    clearSelection ? clearSelection() : handleSelectionChange([]);
  }, [clearSelection, handleSelectionChange]);

  // Sync LayoutStore to layoutRef
  useEffect(() => {
    const sync = () => {
      layoutRef.current = layoutStore.items;
    };
    sync();
  }, [layoutStore.items]);

  const handleShellKeyDown = useCallback(() => { }, []);
  const focusShell = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  const { scrollRef } = useDocumentsViewStateContext();

  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      // Handle events if the container or the shared scrollRef is focused
      // This allows unified handlers (which focus scrollRef) to work seamlessly with Desktop shortcuts
      const isTargetContainer = e.target === containerRef.current;
      const isTargetScrollRef = scrollRef && e.target === scrollRef.current;

      if (!isTargetContainer && !isTargetScrollRef) {
        return;
      }

      // Space preview logic
      if ((e.code === 'Space' || e.code === 'Enter') && selectedDocumentIds.length > 0) {
        const lastId = selectedDocumentIds[selectedDocumentIds.length - 1];
        const doc = items.find(i => String(i.id) === lastId);
        if (doc) {
          e.preventDefault();
          const target = e.code === 'Enter' ? 'inspect' : 'preview';
          openDocument(doc, target);
          return;
        }
      }

      // Navigation logic
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        const layoutItems = Array.from(layoutStore.items.values()) as LayoutCard[];
        if (layoutItems.length === 0) return;

        let activeCard = null;
        if (selectedDocumentIds.length > 0) {
          // Use the last selected item as the anchor
          const lastId = selectedDocumentIds[selectedDocumentIds.length - 1];
          activeCard = layoutStore.items.get(lastId);
        }

        // If no selection or active card not found, select the top-most item
        if (!activeCard) {
          const topMost = layoutItems.reduce((prev, current) => (prev.z > current.z ? prev : current));
          handleSelectionChange([topMost.id]);
          return;
        }

        const cx = activeCard.centerX;
        const cy = activeCard.centerY;

        let bestCandidate = null;
        let minScore = Infinity;

        for (const candidate of layoutItems) {
          if (candidate.id === activeCard.id) continue;

          const dx = candidate.centerX - cx;
          const dy = candidate.centerY - cy;

          let valid = false;
          let primaryDist = 0;
          let offAxisDist = 0;

          switch (e.key) {
            case 'ArrowRight':
              if (dx > 0 && dx > Math.abs(dy)) {
                valid = true;
                primaryDist = dx;
                offAxisDist = Math.abs(dy);
              }
              break;
            case 'ArrowLeft':
              if (dx < 0 && -dx > Math.abs(dy)) {
                valid = true;
                primaryDist = -dx;
                offAxisDist = Math.abs(dy);
              }
              break;
            case 'ArrowDown':
              if (dy > 0 && dy > Math.abs(dx)) {
                valid = true;
                primaryDist = dy;
                offAxisDist = Math.abs(dx);
              }
              break;
            case 'ArrowUp':
              if (dy < 0 && -dy > Math.abs(dx)) {
                valid = true;
                primaryDist = -dy;
                offAxisDist = Math.abs(dx);
              }
              break;
          }

          if (valid) {
            // Weighted score: favor items closer in the primary direction, penalize off-axis
            // We use a multiplier for off-axis distance to prefer "straighter" lines
            // Reduced off-axis weight to favor directional distance (grid-like behavior)
            let score = primaryDist + (offAxisDist * 0.2);

            // Z-Order Bonus: Subtract a small value based on Z-index to favor higher items
            // Assuming max Z is around 10000, 0.1 gives a max bonus of 1000, which is significant but less than primary distance usually
            score -= (candidate.z * 0.05);

            // Obstruction Penalty: Check if the candidate is obstructed
            // If less than 5% is visible, treat as obstructed
            if (candidate.getVisibleFraction() < 0.05) {
              score += 5000; // Huge penalty for obstructed items
            }

            if (score < minScore) {
              minScore = score;
              bestCandidate = candidate;
            }
          }
        }

        if (bestCandidate) {
          if (e.shiftKey) {
            // Additive selection
            const newSelection = new Set(selectedDocumentIds);
            newSelection.add(bestCandidate.id);
            handleSelectionChange(Array.from(newSelection));
          } else {
            // Replace selection
            handleSelectionChange([bestCandidate.id]);
          }
        }
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [selectedDocumentIds, items, openDocument, layoutStore, handleSelectionChange, scrollRef]);

  return (
    <>
      <div
        className="desk-shell"
      >
        <div
          className="desk-canvas"
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleShellKeyDown}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              // Register background pointer
              addPointer(e.pointerId);
              (e.target as Element).setPointerCapture(e.pointerId);

              onClearSelection();
              focusShell();
            }
          }}
          onPointerUp={(e) => {
            if (e.target === e.currentTarget) {
              removePointer(e.pointerId);
              (e.target as Element).releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={(e) => {
            if (e.target === e.currentTarget) {
              removePointer(e.pointerId);
              (e.target as Element).releasePointerCapture(e.pointerId);
            }
          }}
        >
          {isLayoutReady && items.map((doc, index) => {
            const docId = doc.id ? String(doc.id) : `temp-${index}`;
            const isSelected = selectedDocumentIds.includes(docId);

            const layoutCard = layoutStore.items.get(docId);

            if (!layoutCard) {
              return null;
            }

            return (
              <DesktopDocumentCard
                key={docId}
                doc={doc}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  touchAction: 'none',
                  willChange: 'transform'
                }}
                shouldLoad={true}
                matchesFilter={true}

                selected={isSelected}
                docTagTokens=""
                ensureAssetUrl={ensureAssetUrl}
                getDocumentAsset={getDocumentAsset}
                onDocumentActivate={(_id, event) => {
                  const isPreview = event && ((event as any).altKey || (event as any).button === 1);
                  openDocument(doc, isPreview ? 'preview' : 'inspect');
                }}
                layoutCard={layoutCard}
                tagHandlers={tagHandlers}
                onSelect={(ids, extend = false) => {
                  if (!extend) {
                    handleSelectionChange(ids);
                  } else {
                    const newSelection = new Set(selectedDocumentIds);
                    ids.forEach(id => newSelection.add(id));
                    handleSelectionChange(Array.from(newSelection));
                  }
                }}
                onDeselect={(ids) => {
                  const newSelection = new Set(selectedDocumentIds);
                  ids.forEach(id => newSelection.delete(id));
                  handleSelectionChange(Array.from(newSelection));
                }}
                selection={selectedDocumentIds}
                requestCanvasFocus={focusShell}
              />
            );
          })}
        </div>
      </div>
    </>
  );
};

const DesktopWorkspace: React.FC<DesktopWorkspaceProps> = (props) => {
  return (
    <PointerTrackingProvider>
      <DesktopWorkspaceContent {...props} />
    </PointerTrackingProvider>
  );
};

export default DesktopWorkspace;
