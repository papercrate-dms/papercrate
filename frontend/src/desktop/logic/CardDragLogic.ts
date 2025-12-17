import { LayoutStore } from './LayoutSystem';

export const handleDragStart = (store: LayoutStore, selection: string[], leadingId: string, offset: { x: number, y: number }, pointerId: number) => {
    const leadingCard = store.items.get(leadingId);
    if (!leadingCard) return;

    // 1. Begin drag on the leader (clears old followers)
    leadingCard.physics.beginDrag(offset, pointerId);

    // 2. Snap all followers to leader's center
    // 3. Attach them as followers to the leader's physics
    selection.forEach(id => {
        if (id === leadingId) return;
        const card = store.items.get(id);
        if (card) {
            // If card is already dragging by another pointer, skip it
            if (card.physics.isDragging && card.physics.dragPointerId !== pointerId) return;

            const leadingCenterX = leadingCard.x + leadingCard.width / 2;
            const leadingCenterY = leadingCard.y + leadingCard.height / 2;

            const targetX = leadingCenterX - card.width / 2;
            const targetY = leadingCenterY - card.height / 2;

            card.snapTo(targetX, targetY);

            // Stop any existing physics on the follower
            card.physics.stop();

            // Attach as follower
            leadingCard.physics.addFollower(card);
        }
    });
};

export const attachToDragGroup = (store: LayoutStore, selection: string[], leadingId: string, _pointerId: number) => {
    const leadingCard = store.items.get(leadingId);
    if (!leadingCard || !leadingCard.physics.isDragging) return;

    selection.forEach(id => {
        if (id === leadingId) return;
        const card = store.items.get(id);

        // If card exists and is not already dragging, attach it
        if (card && !card.physics.isDragging) {
            const leadingCenterX = leadingCard.x + leadingCard.width / 2;
            const leadingCenterY = leadingCard.y + leadingCard.height / 2;

            const targetX = leadingCenterX - card.width / 2;
            const targetY = leadingCenterY - card.height / 2;

            card.snapTo(targetX, targetY);

            // Stop any existing physics
            card.physics.stop();

            // Attach as follower
            leadingCard.physics.addFollower(card);
        }
    });
};

export const handleDragMove = (store: LayoutStore, _selection: string[], delta: { x: number, y: number }, pointerId: number) => {
    for (const card of store.items.values()) {
        if (card.physics.isDragging && card.physics.dragPointerId === pointerId) {
            card.physics.continueDrag(delta);
        }
    }
};

export const handleDragEnd = (store: LayoutStore, _selection: string[], pointerId: number) => {
    for (const card of store.items.values()) {
        if (card.physics.dragPointerId === pointerId) {
            card.physics.finishDrag();
        }
    }
    store.saveLayout();
};
