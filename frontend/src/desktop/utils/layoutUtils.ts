import type { LayoutCard } from '../logic/LayoutSystem';

export const CONTAINER_PADDING = 18;

export const constrainDimensions = (width: number, height: number, maxDimension: number) => {
    if (width <= maxDimension && height <= maxDimension) {
        return { width, height };
    }

    const aspect = width / height;
    if (width > height) {
        return {
            width: maxDimension,
            height: maxDimension / aspect
        };
    } else {
        return {
            width: maxDimension * aspect,
            height: maxDimension
        };
    }
};

export const getInitialPosition = (
    containerWidth: number,
    containerHeight: number,
    card: LayoutCard,
    _existingCards: LayoutCard[] = []
): { x: number, y: number, rotation: number } => {
    // Mitchell's Best-Candidate Algorithm (Monte Carlo)
    const K = 20; // Number of candidates to test
    let bestCandidate = { x: 0, y: 0, rotation: 0 };
    let bestScore = -Infinity;

    // Padding to keep cards inside
    const padding = CONTAINER_PADDING;

    // Calculate safe bounds for top-left corner
    const minX = padding;
    const maxX = Math.max(padding, containerWidth - card.width - padding);
    const minY = padding;
    const maxY = Math.max(padding, containerHeight - card.height - padding);

    const newCardRadius = card.outerRadius;
    const halfWidth = card.width / 2;
    const halfHeight = card.height / 2;

    for (let i = 0; i < K; i++) {
        const x = minX + Math.random() * (maxX - minX);
        const y = minY + Math.random() * (maxY - minY);

        const cx = x + halfWidth;
        const cy = y + halfHeight;

        // Distance to nearest edge
        const distEdge = Math.min(
            x, // Left
            containerWidth - (x + card.width), // Right
            y, // Top
            containerHeight - (y + card.height) // Bottom
        );

        // Distance to nearest neighbor
        let minNeighborDist = Infinity;
        for (const other of _existingCards) {
            const dx = cx - other.centerX;
            const dy = cy - other.centerY;
            const distSq = dx * dx + dy * dy;

            const radiiSum = newCardRadius + other.outerRadius;
            const distToEdge = distSq - radiiSum * radiiSum;

            if (distToEdge < minNeighborDist) {
                minNeighborDist = distToEdge;
            }
        }

        const score = Math.min(distEdge, minNeighborDist);

        if (score > bestScore) {
            bestScore = score;
            bestCandidate = { x, y, rotation: Math.random() * 10 - 5 };
        }
    }

    return bestCandidate;
};
