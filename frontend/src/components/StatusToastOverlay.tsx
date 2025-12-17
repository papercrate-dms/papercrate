import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useStatusToast } from '../lib/context/StatusToastContext';
import '../styles/status-toast.css';

const FADE_OUT_DURATION = 300; // Match CSS animation duration

const StatusToastOverlay: React.FC = () => {
    const { toasts, removeToast } = useStatusToast();
    const [exitingToasts, setExitingToasts] = useState<Set<string>>(new Set());
    const [displayToasts, setDisplayToasts] = useState(toasts);
    const prevToastIdsRef = useRef<Set<string>>(new Set());

    // Detect when toasts are removed from context and trigger fade
    useEffect(() => {
        const currentIds = new Set(toasts.map(t => t.id));
        const prevIds = prevToastIdsRef.current;

        // Find toasts that were removed
        const removedIds = Array.from(prevIds).filter((id) => typeof id === 'string' && !currentIds.has(id));

        // Trigger fade for removed toasts
        if (removedIds.length > 0) {
            setExitingToasts(prev => {
                const next = new Set(prev);
                removedIds.forEach(id => next.add(id));
                return next;
            });

            // Remove from display after fade
            setTimeout(() => {
                setDisplayToasts(current => current.filter(t => !removedIds.includes(t.id)));
                setExitingToasts(prev => {
                    const next = new Set(prev);
                    removedIds.forEach(id => next.delete(id));
                    return next;
                });
            }, FADE_OUT_DURATION);
        }

        // Add new toasts to display
        const newToasts = toasts.filter(t => !prevIds.has(t.id));
        if (newToasts.length > 0) {
            setDisplayToasts(toasts);
        }

        prevToastIdsRef.current = currentIds;
    }, [toasts]);

    const handleRemove = useCallback((id: string) => {
        removeToast(id);
    }, [removeToast]);

    if (displayToasts.length === 0) {
        return null;
    }

    return (
        <div className="status-toast-container">
            {[...displayToasts].reverse().map((toast) => {
                const isExiting = exitingToasts.has(toast.id);
                const classNames = [
                    'status-toast-pill',
                    `status-toast-pill--${toast.variant}`,
                    isExiting ? 'status-toast-pill--exiting' : '',
                ].filter(Boolean).join(' ');

                return (
                    <div
                        key={toast.id}
                        className={classNames}
                        onClick={() => handleRemove(toast.id)}
                        role="status"
                        aria-live="polite"
                    >
                        {toast.message}
                    </div>
                );
            })}
        </div>
    );
};

export default StatusToastOverlay;
