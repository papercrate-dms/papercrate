import { createContext, useContext, type Context } from 'react';

/**
 * Creates a React context with a paired hook that throws a helpful error
 * if used outside of the provider.
 *
 * @example
 * const [ApiContext, useApi] = createSafeContext<ApiContextValue>('Api');
 *
 * // In component:
 * const api = useApi(); // throws if outside ApiProvider
 */
export function createSafeContext<T>(name: string): [Context<T | null>, () => T] {
    const Context = createContext<T | null>(null);

    const useContextHook = (): T => {
        const ctx = useContext(Context);
        if (!ctx) {
            throw new Error(`use${name} must be used within a ${name}Provider`);
        }
        return ctx;
    };

    return [Context, useContextHook];
}
