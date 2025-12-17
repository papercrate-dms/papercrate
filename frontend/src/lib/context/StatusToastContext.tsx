import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createSafeContext } from '../../utils/createSafeContext';

export type ToastVariant = 'info' | 'success' | 'error';

interface ToastMessage {
    id: string;
    message: string;
    variant: ToastVariant;
    timestamp: number;
    duration: number;
}

interface StatusToastContextValue {
    toasts: ToastMessage[];
    showToast: (message: string, variant?: ToastVariant, duration?: number) => void;
    removeToast: (id: string) => void;
}

const [StatusToastContext, useStatusToast] = createSafeContext<StatusToastContextValue>('StatusToast');

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
    success: 3000,
    info: 5000,
    error: 8000,
};

const MAX_TOASTS = 3;

export const StatusToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const timeoutRefs = useRef<Map<string, number>>(new Map());

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));

        // Clear timeout if it exists
        const timeout = timeoutRefs.current.get(id);
        if (timeout) {
            clearTimeout(timeout);
            timeoutRefs.current.delete(id);
        }
    }, []);

    const showToast = useCallback((message: string, variant: ToastVariant = 'info', duration?: number) => {
        // Log to console based on variant
        if (variant === 'error') {
            console.error(`[Toast] ${message}`);
        } else if (variant === 'success') {
            console.log(`[Toast] ${message}`);
        } else {
            console.info(`[Toast] ${message}`);
        }

        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const finalDuration = duration ?? DEFAULT_DURATIONS[variant];

        const newToast: ToastMessage = {
            id,
            message,
            variant,
            timestamp: Date.now(),
            duration: finalDuration,
        };

        setToasts((prev) => {
            const updated = [...prev, newToast];

            // If we exceed max toasts, remove the oldest ones
            if (updated.length > MAX_TOASTS) {
                const removed = updated.slice(0, updated.length - MAX_TOASTS);
                removed.forEach((toast) => {
                    const timeout = timeoutRefs.current.get(toast.id);
                    if (timeout) {
                        clearTimeout(timeout);
                        timeoutRefs.current.delete(toast.id);
                    }
                });
                return updated.slice(-MAX_TOASTS);
            }

            return updated;
        });

        // Set auto-dismiss timeout - trigger fade then remove
        const timeout = setTimeout(() => {
            removeToast(id);
        }, finalDuration);

        timeoutRefs.current.set(id, timeout);
    }, [removeToast]);

    // Cleanup all timeouts on unmount
    useEffect(() => {
        const timeouts = timeoutRefs.current;
        return () => {
            timeouts.forEach((timeout) => clearTimeout(timeout));
            timeouts.clear();
        };
    }, []);

    const value: StatusToastContextValue = {
        toasts,
        showToast,
        removeToast,
    };

    return (
        <StatusToastContext.Provider value={value}>
            {children}
        </StatusToastContext.Provider>
    );
};

export { useStatusToast };
