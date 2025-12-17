import React, { useRef, useCallback } from 'react';
import { createSafeContext } from '../../utils/createSafeContext';

interface PointerTrackingContextType {
    activePointersRef: React.MutableRefObject<Map<number, string | undefined>>;
    addPointer: (id: number, cardId?: string) => void;
    removePointer: (id: number) => void;
}

const [PointerTrackingContext, usePointerTracking] = createSafeContext<PointerTrackingContextType>('PointerTracking');

export const PointerTrackingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const activePointersRef = useRef(new Map<number, string | undefined>());

    const addPointer = useCallback((id: number, cardId?: string) => {
        activePointersRef.current.set(id, cardId);
    }, []);

    const removePointer = useCallback((id: number) => {
        activePointersRef.current.delete(id);
    }, []);

    return React.createElement(
        PointerTrackingContext.Provider,
        { value: { activePointersRef, addPointer, removePointer } },
        children
    );
};

export { usePointerTracking };
