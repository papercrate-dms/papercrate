import { createSafeContext } from '../../utils/createSafeContext';

type AppShellContextValue = Record<string, unknown>;

export const [AppShellContext, useAppShell] = createSafeContext<AppShellContextValue>('AppShell');
