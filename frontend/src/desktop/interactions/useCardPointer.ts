import React, { useCallback, useRef } from 'react';
import { usePointerTracking } from './PointerTrackingContext';

import { LayoutCard } from '../logic/LayoutSystem';
import { handleDragMove, handleDragEnd, handleDragStart, attachToDragGroup } from '../logic/CardDragLogic';

const DRAG_THRESHOLD = 3;

type PointerState = 'idle' | 'click' | 'drag';

export const useCardPointer = (
    card: LayoutCard,
    isSelected: boolean,
    selection: string[],
    onSelect: (ids: string[], extend?: boolean) => void,
    onDeselect: (ids: string[]) => void,
    onDocumentActivate?: (id: string, event?: React.PointerEvent) => void,
    requestCanvasFocus?: () => void
) => {
    const [state, setState] = React.useState<PointerState>('idle');
    const initialPosition = useRef<{ x: number, y: number } | null>(null);
    const lastPosition = useRef<{ x: number, y: number } | null>(null);
    const lastClickTime = useRef<number>(0);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { activePointersRef, addPointer, removePointer } = usePointerTracking();

    const updateState = useCallback((e: React.PointerEvent) => {
        if (state === 'click' && initialPosition.current) {
            const dx = e.clientX - initialPosition.current.x;
            const dy = e.clientY - initialPosition.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > DRAG_THRESHOLD) {
                setState('drag-start');
            }
        }
    }, [state]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        // Allow left (0) and middle (1) click
        if (e.button !== 0 && e.button !== 1) return;

        // Ignore interactions on interactive child elements (tags, inputs, buttons, etc.)
        // We want these elements to handle their own pointer/drag events.
        const target = e.target as Element;
        const interactive = target.closest('button, a, input, textarea, select, [draggable="true"]');
        if (interactive && interactive !== e.currentTarget) {
            return;
        }

        e.preventDefault();

        (e.target as Element).setPointerCapture(e.pointerId);

        // Register pointer with card ID
        addPointer(e.pointerId, card.id);

        requestCanvasFocus?.();

        setState('click');
        initialPosition.current = { x: e.clientX, y: e.clientY };
        lastPosition.current = { x: e.clientX, y: e.clientY };

        // Long press detection for touch devices
        if (e.pointerType === 'touch') {
            longPressTimer.current = setTimeout(() => {
                // Select stack
                const stackIds = card.store.getStackBelow(card);
                const idsToAdd = new Set<string>();

                if (!isSelected) idsToAdd.add(card.id);
                stackIds.forEach(id => idsToAdd.add(id));

                // Only select what isn't already selected
                const unselectedIdsToAdd = Array.from(idsToAdd).filter(id => !selection.includes(id));

                if (unselectedIdsToAdd.length > 0) {
                    onSelect(unselectedIdsToAdd, true);

                    const isMultiTouch = activePointersRef.current.size > 1;
                    if (isMultiTouch) {
                        // Find an existing drag group to attach to
                        let targetLeaderId: string | null = null;
                        let targetPointerId: number | null = null;

                        for (const [ptrId, cId] of activePointersRef.current.entries()) {
                            if (ptrId === e.pointerId) continue; // Skip self
                            if (cId) {
                                const c = card.store.items.get(cId);
                                if (c && c.isDragging) {
                                    targetLeaderId = cId;
                                    targetPointerId = c.physics.dragPointerId; // Use the pointer driving that card
                                    break; // Attach to the first found drag group
                                }
                            }
                        }

                        if (targetLeaderId && targetPointerId !== null) {
                            attachToDragGroup(card.store, unselectedIdsToAdd, targetLeaderId, targetPointerId);
                        }
                    }

                    // Haptic feedback if available
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }
            }, 500); // 500ms long press
        }
    }, [card, isSelected, selection, onSelect, addPointer, activePointersRef, requestCanvasFocus]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        // Ignore interactions on interactive child elements
        const target = e.target as Element;
        const interactive = target.closest('button, a, input, textarea, select, [draggable="true"]');
        if (interactive && interactive !== e.currentTarget) {
            return;
        }

        e.preventDefault();

        // Check for multi-touch (more than 1 active pointer implies we should add to selection)
        // We check > 1 because the current pointer is already added
        const isMultiTouch = activePointersRef.current.size > 1;
        const hasModifier = e.metaKey || e.ctrlKey || e.shiftKey || isMultiTouch;

        updateState(e);

        // Cancel long press if moved
        if (state === 'click' && initialPosition.current) {
            const dx = e.clientX - initialPosition.current.x;
            const dy = e.clientY - initialPosition.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > DRAG_THRESHOLD && longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
        }

        if (state === 'drag-start') {
            let effectiveSelection = selection;

            if (!hasModifier) {
                if (!isSelected) {
                    effectiveSelection = [card.id];
                    onSelect([card.id], false);
                }
            } else {
                // Modifier pressed: Add card and stack to selection
                const stackIds = card.store.getStackBelow(card);
                const idsToAdd = new Set<string>();

                if (!isSelected) idsToAdd.add(card.id);
                stackIds.forEach(id => idsToAdd.add(id));

                // Only select what isn't already selected to avoid toggling off
                const unselectedIdsToAdd = Array.from(idsToAdd).filter(id => !selection.includes(id));

                if (unselectedIdsToAdd.length > 0) {
                    onSelect(unselectedIdsToAdd, true);
                    effectiveSelection = [...selection, ...unselectedIdsToAdd];
                }
            }

            card.store.bringToFront(effectiveSelection);

            setState('drag');

            // Start the drag for THIS pointer
            if (initialPosition.current) {
                const rect = card.ref.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;

                const leadingCardId = card.id;

                const offset = {
                    x: initialPosition.current.x - centerX,
                    y: initialPosition.current.y - centerY
                };

                handleDragStart(card.store, effectiveSelection, leadingCardId, offset, e.pointerId);
                // Reset lastPosition to current pointer to avoid jump on first move
                lastPosition.current = { x: e.clientX, y: e.clientY };
            }
        }

        if (state === 'drag' && lastPosition.current) {
            const delta = {
                x: e.clientX - lastPosition.current.x,
                y: e.clientY - lastPosition.current.y
            };

            if (delta.x !== 0 || delta.y !== 0) {
                handleDragMove(card.store, selection, delta, e.pointerId);
                lastPosition.current = { x: e.clientX, y: e.clientY };
            }
        }
    }, [card, state, updateState, isSelected, selection, onSelect, activePointersRef]);

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        // Ignore interactions on interactive child elements
        const target = e.target as Element;
        const interactive = target.closest('button, a, input, textarea, select, [draggable="true"]');
        if (interactive && interactive !== e.currentTarget) {
            return;
        }

        e.preventDefault();

        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }

        // Check for multi-touch before removing the pointer
        const isMultiTouch = activePointersRef.current.size > 1;
        const hasModifier = e.metaKey || e.ctrlKey || e.shiftKey || isMultiTouch;

        // Unregister pointer
        removePointer(e.pointerId);

        updateState(e);

        if (state === 'drag' || state === 'drag-start') {
            handleDragEnd(card.store, selection, e.pointerId);
        } else if (state === 'click') {
            const now = Date.now();
            if (now - lastClickTime.current < 300) {
                onDocumentActivate?.(card.id, e);
            }
            lastClickTime.current = now;

            if (isSelected) {
                if (hasModifier) {
                    onDeselect([card.id]);
                }
            } else {
                onSelect([card.id], hasModifier);

                if (!hasModifier) {
                    card.bringToFront();
                }
            }
        }

        setState('idle');
        initialPosition.current = null;
        lastPosition.current = null;
        (e.target as Element).releasePointerCapture(e.pointerId);
    }, [card, state, isSelected, onSelect, onDeselect, onDocumentActivate, updateState, selection, activePointersRef, removePointer]);

    const onPointerCancel = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }

        // Ensure we clean of any drags associated with this pointer
        handleDragEnd(card.store, selection, e.pointerId);

        removePointer(e.pointerId);
        setState('idle');
        initialPosition.current = null;
        lastPosition.current = null;
        (e.target as Element).releasePointerCapture(e.pointerId);
    }, [card, selection, removePointer]);

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel
    };
};
