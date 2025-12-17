import { constrainDimensions, getInitialPosition, CONTAINER_PADDING } from '../utils/layoutUtils';

import { fetchLayoutRecords, upsertLayoutRecords } from './db';
import { CardPhysics } from './CardPhysics';

interface LayoutCardState {
    id: string;
    x: number;
    y: number;
    z: number;
    rotation: number;
    width: number;
    height: number;
    pageCount: number;
}

export class LayoutCard implements LayoutCardState {
    id: string;
    x: number = 0;
    y: number = 0;
    z: number = 0;
    rotation: number = 0;
    width: number = 0;
    height: number = 0;
    pageCount: number = 1;
    ref: HTMLElement | null = null;

    private _innerRadius: number = 0;
    private _outerRadius: number = 0;
    private _centerX: number = 0;
    private _centerY: number = 0;
    public store: LayoutStore;
    public physics: CardPhysics;
    public intendedX: number = 0;
    public intendedY: number = 0;
    public isDirty: boolean = false;

    constructor(id: string, store: LayoutStore, initialData: Partial<LayoutCardState> = {}, ref: HTMLElement | null = null) {
        this.id = id;
        this.store = store;
        Object.assign(this, initialData);
        this.physics = new CardPhysics(this);
        this.intendedX = this.x;
        this.intendedY = this.y;
        this.ref = ref;
        this.recalculateRadii();
        this.recalculateCenters();
    }

    setRef(ref: HTMLElement | null) {
        this.ref = ref;
        this.applyTransform();
    }

    getConstrainedPosition(x: number, y: number): { x: number, y: number } {
        const rad = (this.rotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));

        const rotatedWidth = this.width * cos + this.height * sin;
        const rotatedHeight = this.width * sin + this.height * cos;

        const minX = CONTAINER_PADDING + (rotatedWidth - this.width) / 2;
        const maxX = this.store.containerWidth - CONTAINER_PADDING - this.width - (rotatedWidth - this.width) / 2;

        const minY = CONTAINER_PADDING + (rotatedHeight - this.height) / 2;
        const maxY = this.store.containerHeight - CONTAINER_PADDING - this.height - (rotatedHeight - this.height) / 2;

        const newX = Math.max(minX, Math.min(x, maxX));
        const newY = Math.max(minY, Math.min(y, maxY));

        return { x: newX, y: newY };
    }



    update(changes: Partial<LayoutCardState>, options: { markDirty?: boolean, isConstraintUpdate?: boolean } = {}) {
        Object.assign(this, changes);

        if (!options.isConstraintUpdate) {
            if (changes.x !== undefined) this.intendedX = changes.x;
            if (changes.y !== undefined) this.intendedY = changes.y;
        }

        if (changes.width !== undefined || changes.height !== undefined) {
            this.recalculateRadii();
        }

        if (changes.x !== undefined || changes.y !== undefined || changes.width !== undefined || changes.height !== undefined) {
            this.recalculateCenters();
        }

        if (changes.pageCount !== undefined) {
            this.physics.updateMass(changes.pageCount);
        }

        if (options.markDirty) {
            this.isDirty = true;
        }

        this.applyTransform();
    }

    isUnobstructed(): boolean {
        for (const other of this.store.items.values()) {
            if (other.id === this.id) continue;
            if (other.z <= this.z) continue;

            const dx = other.x - this.x;
            const dy = other.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Broad phase: check outer radii
            if (distance < this.outerRadius + other.outerRadius) {
                // Narrow phase: SAT intersection test
                if (this.intersects(other)) {
                    return false;
                }
            }
        }

        return true;
    }

    bringToFront() {
        this.z = this.store.zCounter++;
    }

    private getVertices(): { x: number; y: number }[] {
        const rad = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const hw = this.width / 2;
        const hh = this.height / 2;

        // Corners relative to center, then rotated, then translated
        // (-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)
        const corners = [
            { x: -hw, y: -hh },
            { x: hw, y: -hh },
            { x: hw, y: hh },
            { x: -hw, y: hh }
        ];

        return corners.map(p => ({
            x: (p.x * cos - p.y * sin) + this._centerX,
            y: (p.x * sin + p.y * cos) + this._centerY
        }));
    }

    containsPoint(x: number, y: number): boolean {
        // Translate point to local space relative to center
        const dx = x - this._centerX;
        const dy = y - this._centerY;

        // Rotate point by -rotation to align with AABB
        const rad = (-this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        const hw = this.width / 2;
        const hh = this.height / 2;

        return localX >= -hw && localX <= hw && localY >= -hh && localY <= hh;
    }

    getVisibleFraction(): number {
        const samplesX = 4;
        const samplesY = 4;
        const totalSamples = samplesX * samplesY;
        let visibleSamples = 0;

        // Get potential occluders (higher Z-index)
        const occluders = Array.from(this.store.items.values()).filter(other =>
            other.id !== this.id && other.z > this.z
        );

        if (occluders.length === 0) return 1.0;

        const rad = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const hw = this.width / 2;
        const hh = this.height / 2;

        // Sample points across the card surface
        for (let i = 0; i < samplesX; i++) {
            for (let j = 0; j < samplesY; j++) {
                // Normalized coordinates [-1, 1]
                const nx = (i / (samplesX - 1)) * 2 - 1;
                const ny = (j / (samplesY - 1)) * 2 - 1;

                // Local coordinates
                const lx = nx * hw * 0.9; // 0.9 to avoid edge cases
                const ly = ny * hh * 0.9;

                // World coordinates
                const wx = (lx * cos - ly * sin) + this._centerX;
                const wy = (lx * sin + ly * cos) + this._centerY;

                // Check occlusion
                let isOccluded = false;
                for (const occluder of occluders) {
                    if (occluder.containsPoint(wx, wy)) {
                        isOccluded = true;
                        break;
                    }
                }

                if (!isOccluded) {
                    visibleSamples++;
                }
            }
        }

        return visibleSamples / totalSamples;
    }

    private getAxes(): { x: number; y: number }[] {
        const rad = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        // Normals of the edges (local x and y axes)
        return [
            { x: cos, y: sin },
            { x: -sin, y: cos }
        ];
    }

    private intersects(other: LayoutCard): boolean {
        const verticesA = this.getVertices();
        const verticesB = other.getVertices();
        const axes = [...this.getAxes(), ...other.getAxes()];

        for (const axis of axes) {
            const pA = this.project(verticesA, axis);
            const pB = this.project(verticesB, axis);

            if (pA.max < pB.min || pB.max < pA.min) {
                return false; // Gap found, no intersection
            }
        }
        return true;
    }

    private project(vertices: { x: number; y: number }[], axis: { x: number; y: number }) {
        let min = Infinity;
        let max = -Infinity;
        for (const v of vertices) {
            const dot = v.x * axis.x + v.y * axis.y;
            if (dot < min) min = dot;
            if (dot > max) max = dot;
        }
        return { min, max };
    }

    private recalculateRadii() {
        this._innerRadius = Math.min(this.width, this.height) / 2;
        this._outerRadius = Math.sqrt(this.width * this.width + this.height * this.height) / 2;
    }

    private recalculateCenters() {
        this._centerX = this.x + this.width / 2;
        this._centerY = this.y + this.height / 2;
    }

    private rafId: number | null = null;

    private applyTransform() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        this.rafId = requestAnimationFrame(() => {
            if (this.ref) {
                this.ref.style.transform =
                    `translate3d(${this.x}px, ${this.y}px, 0) rotate(${this.rotation}deg)`;
                this.ref.style.zIndex = String(this.z);
                this.ref.style.width = `${this.width}px`;
                this.ref.style.height = `${this.height}px`;
            }
            this.rafId = null;
        });
    }

    snapTo(x: number, y: number) {
        this.update({ x, y }, { markDirty: true });

        if (!this.ref)
            return;

        this.ref.classList.add('desk-item--swoop');
        this.ref.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) rotate(${this.rotation}deg)`;

        const cleanup = () => {
            if (this.ref) {
                this.ref.classList.remove('desk-item--swoop');
            }
        };

        this.ref.addEventListener('transitionend', cleanup, { once: true });

        // Safety timeout in case transitionend doesn't fire (e.g. element removed)
        setTimeout(cleanup, 350);
    }

    toSnapshot(): LayoutCardState {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            z: this.z,
            rotation: this.rotation,
            width: this.width,
            height: this.height,
            pageCount: this.pageCount
        };
    }

    get innerRadius(): number {
        return this._innerRadius;
    }

    get outerRadius(): number {
        return this._outerRadius;
    }

    get centerX(): number {
        return this._centerX;
    }

    get centerY(): number {
        return this._centerY;
    }

    get isDragging(): boolean {
        return this.physics.isDragging;
    }
}

export class LayoutStore {
    items = new Map<string, LayoutCard>();
    zCounter = 100;
    containerWidth: number = 0;
    containerHeight: number = 0;

    private savedLayouts = new Map<string, { x: number, y: number, rotation: number, z: number }>();
    private tenantId: string | null = null;
    private viewId: string | null = null;

    initialize(id: string, ref: HTMLElement | null, config: {
        width: number;
        height: number;
        pageCount: number;
        maxSize?: number;
    }) {
        let card = this.items.get(id);

        const { width, height } = constrainDimensions(
            config.width,
            config.height,
            config.maxSize || 320
        );

        if (!card) {
            // Check for saved layout
            const saved = this.savedLayouts.get(id);

            let x, y, rotation, z;

            if (saved) {
                x = saved.x;
                y = saved.y;
                rotation = saved.rotation;
                z = saved.z;
                // Ensure zCounter is higher than any loaded z
                if (z >= this.zCounter) {
                    this.zCounter = z + 1;
                }

                card = new LayoutCard(id, this, {
                    x,
                    y,
                    rotation,
                    width,
                    height,
                    z,
                    pageCount: config.pageCount
                }, ref);
            } else {
                // Create card with temporary position
                card = new LayoutCard(id, this, {
                    width,
                    height,
                    z: this.zCounter++,
                    pageCount: config.pageCount
                }, ref);

                // Calculate initial position using the card instance
                const { x: initX, y: initY, rotation: initRotation } = getInitialPosition(
                    this.containerWidth,
                    this.containerHeight,
                    card,
                    Array.from(this.items.values())
                );

                // Update card with calculated position
                card.update({ x: initX, y: initY, rotation: initRotation }, { markDirty: true });
            }

            this.items.set(id, card);
        } else {
            card.update({ width, height, pageCount: config.pageCount }, { markDirty: false });
        }

        // Always update ref and ensure transform is applied
        if (card.ref !== ref) {
            card.setRef(ref);
        }

        return card;
    }

    unregister(id: string) {
        this.items.delete(id);
    }

    clear() {
        this.items.clear();
        this.zCounter = 100;
        this.savedLayouts.clear();
    }

    setContainerSize(width: number, height: number) {
        this.containerWidth = width;
        this.containerHeight = height;
        this.relayout();
    }

    relayout() {
        for (const card of this.items.values()) {
            const { x, y } = card.getConstrainedPosition(card.intendedX, card.intendedY);
            if (x !== card.x || y !== card.y) {
                card.update({ x, y }, { markDirty: false, isConstraintUpdate: true });
            }
        }
    }

    getCardsInCircle(x: number, y: number, radius: number): LayoutCard[] {
        const result: LayoutCard[] = [];
        for (const card of this.items.values()) {
            // Calculate center of candidate card
            const cx = card.x + card.width / 2;
            const cy = card.y + card.height / 2;

            const dx = cx - x;
            const dy = cy - y;

            const distSq = dx * dx + dy * dy;
            const limit = radius;

            if (distSq < limit * limit) {
                result.push(card);
            }
        }
        return result;
    }

    getStackBelow(topCard: LayoutCard): string[] {
        const centerX = topCard.x + topCard.width / 2;
        const centerY = topCard.y + topCard.height / 2;
        const candidates = this.getCardsInCircle(centerX, centerY, topCard.innerRadius);

        return candidates
            .filter(other => {
                if (other.id === topCard.id) return false;
                if (other.z >= topCard.z) return false;
                return true;
            })
            .map(c => c.id);
    }

    bringToFront(ids: string[]) {
        const cards = ids
            .map(id => this.items.get(id))
            .filter((c): c is LayoutCard => !!c);

        // Sort by current Z-index to preserve relative order
        cards.sort((a, b) => a.z - b.z);

        // Assign new Z-indices
        for (const card of cards) {
            card.update({ z: this.zCounter++ }, { markDirty: true });
        }
    }

    getSnapshot() {
        return Array.from(this.items.values()).map(card => card.toSnapshot());
    }

    async loadLayout(tenantId: string, viewId: string) {
        this.tenantId = tenantId;
        this.viewId = viewId;

        const records = await fetchLayoutRecords({ tenantId, viewId });

        this.savedLayouts.clear();
        let maxZ = this.zCounter;

        for (const record of records) {
            if (record.documentId && record.centerX !== undefined && record.centerY !== undefined) {
                this.savedLayouts.set(record.documentId, {
                    x: record.centerX,
                    y: record.centerY,
                    rotation: record.rotation || 0,
                    z: record.zIndex || 0
                });
                if (record.zIndex && record.zIndex >= maxZ) {
                    maxZ = record.zIndex + 1;
                }
            }
        }

        this.zCounter = maxZ;

        // Apply to existing items if any (though usually this runs before items are created)
        for (const [id, card] of this.items) {
            const saved = this.savedLayouts.get(id);
            if (saved) {
                card.update(saved, { markDirty: false });
            }
        }

        // Ensure everything is within bounds
        this.relayout();
    }

    hasSavedLayout(id: string): boolean {
        return this.savedLayouts.has(id);
    }

    async saveLayout() {
        if (!this.tenantId || !this.viewId) return;

        const dirtyCards = Array.from(this.items.values()).filter(card => card.isDirty);
        if (dirtyCards.length === 0) return;

        const entries = dirtyCards.map(card => ({
            documentId: card.id,
            centerX: card.intendedX,
            centerY: card.intendedY,
            rotation: card.rotation,
            zIndex: card.z,
            updatedAt: Date.now()
        }));

        await upsertLayoutRecords({
            tenantId: this.tenantId,
            viewId: this.viewId,
            entries
        });

        // Reset dirty flag for saved cards
        for (const card of dirtyCards) {
            card.isDirty = false;
        }
    }
}
