import { useEffect, useRef } from 'react';
import { clearMagicParamsFromUrl } from '../utils/authUrlUtils';

/**
 * Hook to automatically attempt a magic token login if present in the URL.
 * Handles React StrictMode double-invocation and URL cleanup.
 */
export const useAutoMagicLogin = (
    magicToken: string | null,
    appStatus: string,
    onAttempt: (token: string) => Promise<void>
) => {
    const attemptedRef = useRef<string | null>(null);
    const inFlightRef = useRef(false);

    useEffect(() => {
        if (!magicToken) {
            return;
        }
        // Prevent double-execution in StrictMode or overlapping attempts
        if (inFlightRef.current) {
            return;
        }
        // Don't retry the same token in this session unless it changed
        if (attemptedRef.current === magicToken) {
            return;
        }

        // If we're already authenticated, just clean up the URL to avoid confusion
        if (appStatus === 'authenticated') {
            clearMagicParamsFromUrl();
            return;
        }

        inFlightRef.current = true;
        attemptedRef.current = magicToken;

        let cancelled = false;

        const run = async () => {
            try {
                const tokenToUse = attemptedRef.current;
                if (!tokenToUse) return;
                await onAttempt(tokenToUse);
            } finally {
                if (!cancelled) {
                    inFlightRef.current = false;
                    // Whether success or failure, we clear the specific params 
                    // to prevent an infinite loop of attempts if the token is invalid.
                    clearMagicParamsFromUrl();
                }
            }
        };

        run();

        return () => {
            cancelled = true;
            inFlightRef.current = false;
        };
    }, [magicToken, appStatus, onAttempt]);
};
