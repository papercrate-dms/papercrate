import { LayoutCard } from './LayoutSystem';

export class CardPhysics {
    private velocity: { x: number, y: number, rotation: number } = { x: 0, y: 0, rotation: 0 };
    private _isDragging: boolean = false;
    public dragPointerId: number | null = null;
    private pendingDelta: { x: number, y: number } = { x: 0, y: 0 };

    public mass: number = 30;
    private baseMass: number = 30;
    private massScale: number = 1;
    private angularVelocity: number = 0;
    private lastTimestamp: number = 0;

    private dragOffset: { x: number, y: number } | null = null;

    get isDragging(): boolean {
        return this._isDragging;
    }

    private physicsRafId: number | null = null;
    private lastTickTime: number = 0;
    private card: LayoutCard;

    constructor(card: LayoutCard) {
        this.card = card;
        this.updateMass(card.pageCount);
    }

    updateMass(pageCount: number) {
        const pages = Math.max(1, pageCount);
        this.baseMass = 30 + 5 * pages;
        this.mass = this.baseMass;
        this.updateMassScale();
    }

    private updateMassScale() {
        this.massScale = Math.max(this.mass / 30, 1);
    }

    private normalizeAngle(angle: number): number {
        let a = angle % 360;
        if (a > 180) a -= 360;
        if (a <= -180) a += 360;
        return a;
    }

    beginDrag(offset: { x: number, y: number }, pointerId: number) {
        // If I am a follower of someone else, detach first!
        if (this.leader) {
            this.leader.removeFollower(this.card);
        }

        // Ensure I don't have stale followers from a previous session
        this.stopPhysicsLoop();

        this._isDragging = true;
        this.dragPointerId = pointerId;

        // Store the offset from center where we grabbed the card
        // Convert world offset to local offset (rotate by -rotation)
        const rad = -this.card.rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        this.dragOffset = {
            x: offset.x * cos - offset.y * sin,
            y: offset.x * sin + offset.y * cos
        };

        this.angularVelocity = 0;
        this.startPhysicsLoop();
    }

    continueDrag(delta: { x: number, y: number }) {
        this.pendingDelta.x += delta.x;
        this.pendingDelta.y += delta.y;
    }

    finishDrag() {
        this._isDragging = false;
        this.dragPointerId = null;
        // Keep dragOffset for inertia pivot correction
        this.lastTimestamp = performance.now();
        this.angularVelocity = 0; // Kill momentum on release
    }

    private startPhysicsLoop() {
        if (this.physicsRafId) return;
        this.lastTickTime = performance.now();
        this.physicsRafId = requestAnimationFrame(this.physicsTick);
    }

    public stop() {
        this.stopPhysicsLoop();
    }

    private stopPhysicsLoop() {
        if (this.physicsRafId) {
            cancelAnimationFrame(this.physicsRafId);
            this.physicsRafId = null;
        }
        this.dragOffset = null;
        this.clearFollowers();
    }

    private physicsTick = (time: number) => {
        const rawDt = (time - this.lastTickTime) / 1000;
        const dt = Math.max(1 / 120, Math.min(rawDt, 1 / 20));
        this.lastTickTime = time;

        this.updatePhysics(dt);

        if (this.physicsRafId) {
            this.physicsRafId = requestAnimationFrame(this.physicsTick);
        }
    };

    private readonly ROTATION_LIMIT = 5;
    private minLimit: number = -5;
    private maxLimit: number = 5;

    private followers: { card: LayoutCard, offsetRotation: number }[] = [];
    public leader: CardPhysics | null = null;

    addFollower(card: LayoutCard) {
        // Calculate relative rotation
        // follower = leader + offset  =>  offset = follower - leader
        const offset = this.normalizeAngle(card.rotation - this.card.rotation);
        this.followers.push({ card, offsetRotation: offset });

        // Set back-reference
        card.physics.leader = this;

        // Add follower mass to leader
        this.mass += card.physics.mass;
        this.updateMassScale();

        // Constrain leader limits to ensure follower stays within [-5, 5]
        // But clamp the result to never exceed the global limits [-5, 5]
        // This prevents the leader from being forced into extreme angles by far-away followers
        const calculatedMin = -this.ROTATION_LIMIT - offset;
        const calculatedMax = this.ROTATION_LIMIT - offset;

        this.minLimit = Math.max(this.minLimit, Math.min(this.ROTATION_LIMIT, Math.max(-this.ROTATION_LIMIT, calculatedMin)));
        this.maxLimit = Math.min(this.maxLimit, Math.max(-this.ROTATION_LIMIT, Math.min(this.ROTATION_LIMIT, calculatedMax)));

        // Safety: If limits invert (min > max), prioritize keeping leader near 0
        if (this.minLimit > this.maxLimit) {
            this.minLimit = -this.ROTATION_LIMIT;
            this.maxLimit = this.ROTATION_LIMIT;
        }
    }

    removeFollower(card: LayoutCard) {
        const index = this.followers.findIndex(f => f.card === card);
        if (index !== -1) {
            const follower = this.followers[index];
            follower.card.physics.leader = null;
            this.followers.splice(index, 1);

            // Recalculate mass and limits
            this.recalculateStackProperties();
        }
    }

    clearFollowers() {
        // Clear back-references
        this.followers.forEach(f => {
            f.card.physics.leader = null;
        });
        this.followers = [];
        this.recalculateStackProperties();
    }

    private recalculateStackProperties() {
        this.mass = this.baseMass;
        this.minLimit = -this.ROTATION_LIMIT;
        this.maxLimit = this.ROTATION_LIMIT;

        for (const f of this.followers) {
            this.mass += f.card.physics.mass;

            // Re-apply limits
            const offset = f.offsetRotation;
            const calculatedMin = -this.ROTATION_LIMIT - offset;
            const calculatedMax = this.ROTATION_LIMIT - offset;

            this.minLimit = Math.max(this.minLimit, Math.min(this.ROTATION_LIMIT, Math.max(-this.ROTATION_LIMIT, calculatedMin)));
            this.maxLimit = Math.min(this.maxLimit, Math.max(-this.ROTATION_LIMIT, Math.min(this.ROTATION_LIMIT, calculatedMax)));
        }

        // Safety check
        if (this.minLimit > this.maxLimit) {
            this.minLimit = -this.ROTATION_LIMIT;
            this.maxLimit = this.ROTATION_LIMIT;
        }

        this.updateMassScale();
    }

    private updatePhysics(dt: number) {
        const dx = this.pendingDelta.x;
        const dy = this.pendingDelta.y;

        this.pendingDelta = { x: 0, y: 0 };

        const vx = dx / dt;
        const vy = dy / dt;

        // 1. Update Position (Direct 1:1 movement)
        const newX = this.card.x + dx;
        const newY = this.card.y + dy;
        const constrained = this.card.getConstrainedPosition(newX, newY);

        // 2. Calculate Torque & Forces
        let torque = 0;
        let recoveryTorque = 0;
        let isRecovering = false;

        // Drag Torque
        if (this.dragOffset && this._isDragging) {
            const rad = this.card.rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            const worldLeverX = this.dragOffset.x * cos - this.dragOffset.y * sin;
            const worldLeverY = this.dragOffset.x * sin + this.dragOffset.y * cos;

            torque = worldLeverX * vy - worldLeverY * vx;
        }

        // Recovery Torque
        const normRot = this.normalizeAngle(this.card.rotation);
        if (normRot > this.maxLimit) {
            recoveryTorque = (this.maxLimit - normRot) * 2500;
            isRecovering = true;
        } else if (normRot < this.minLimit) {
            recoveryTorque = (this.minLimit - normRot) * 2500;
            isRecovering = true;
        }

        const totalTorque = torque + recoveryTorque;
        const alpha = (totalTorque * 0.05) / this.massScale;
        this.angularVelocity += alpha * dt;

        // Friction
        this.angularVelocity *= 0.85;
        if (isRecovering) {
            this.angularVelocity *= 0.6;
        }

        // Deadzone
        if (Math.abs(this.angularVelocity) < 1) {
            this.angularVelocity = 0;
        }

        // 3. Update Rotation
        let newRot = this.card.rotation + this.angularVelocity * dt;

        // Ratchet clamping
        const newNormRot = this.normalizeAngle(newRot);

        if (newNormRot > this.maxLimit) {
            // If moving further past max, clamp
            if (newNormRot > normRot) {
                newRot = this.card.rotation + (this.maxLimit - normRot);
                this.angularVelocity = 0;
            }
        } else if (newNormRot < this.minLimit) {
            // If moving further past min, clamp
            if (newNormRot < normRot) {
                newRot = this.card.rotation + (this.minLimit - normRot);
                this.angularVelocity = 0;
            }
        }

        // 4. Pivot Correction
        let correctionX = 0;
        let correctionY = 0;

        if (this.dragOffset) {
            const oldRad = this.card.rotation * Math.PI / 180;
            const oldCos = Math.cos(oldRad);
            const oldSin = Math.sin(oldRad);

            const newRad = newRot * Math.PI / 180;
            const newCos = Math.cos(newRad);
            const newSin = Math.sin(newRad);

            const oldLeverX = this.dragOffset.x * oldCos - this.dragOffset.y * oldSin;
            const oldLeverY = this.dragOffset.x * oldSin + this.dragOffset.y * oldCos;

            const newLeverX = this.dragOffset.x * newCos - this.dragOffset.y * newSin;
            const newLeverY = this.dragOffset.x * newSin + this.dragOffset.y * newCos;

            correctionX = oldLeverX - newLeverX;
            correctionY = oldLeverY - newLeverY;
        }

        // Stop Condition
        if (!this._isDragging) {
            const currentNormRot = this.normalizeAngle(this.card.rotation);
            const isOutside = currentNormRot > this.maxLimit || currentNormRot < this.minLimit;

            if (isOutside) {
                const targetAngle = currentNormRot > this.maxLimit ? this.maxLimit : this.minLimit;
                const dist = Math.abs(this.normalizeAngle(currentNormRot - targetAngle));

                if (Math.abs(this.angularVelocity) < 0.5 && dist < 0.1) {
                    this.card.update({ rotation: targetAngle }, { markDirty: true });
                    this.angularVelocity = 0;
                    this.stopPhysicsLoop();
                    return;
                }
            } else {
                // Inside range - just stop if slow
                if (Math.abs(this.angularVelocity) < 0.5) {
                    this.angularVelocity = 0;
                    this.stopPhysicsLoop();
                    return;
                }
            }
        }

        // 5. Apply to Leader
        const finalX = constrained.x + correctionX;
        const finalY = constrained.y + correctionY;
        const finalConstrained = this.card.getConstrainedPosition(finalX, finalY);

        this.card.update({
            x: finalConstrained.x,
            y: finalConstrained.y,
            rotation: newRot
        }, { markDirty: true });

        // 6. Apply to Followers
        for (const follower of this.followers) {
            // Followers match leader's position exactly (center aligned)
            // But we need to account for their own dimensions if we want center-to-center alignment
            // The LayoutCard.x/y is top-left.
            // Leader Center: finalConstrained.x + leader.width/2, finalConstrained.y + leader.height/2

            const leaderCenterX = finalConstrained.x + this.card.width / 2;
            const leaderCenterY = finalConstrained.y + this.card.height / 2;

            const followerX = leaderCenterX - follower.card.width / 2;
            const followerY = leaderCenterY - follower.card.height / 2;

            const followerRot = newRot + follower.offsetRotation;

            follower.card.update({
                x: followerX,
                y: followerY,
                rotation: followerRot
            }, { markDirty: true });
        }
    }
}
