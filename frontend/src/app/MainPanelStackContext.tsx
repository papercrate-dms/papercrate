import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type MainPanel = 'documents' | 'search' | 'viewer';

interface MainPanelStackContextValue {
  /** The full stack. 'documents' is always at the bottom. */
  stack: MainPanel[];
  /** The panel currently on top. */
  top: MainPanel;
  /** Push a panel onto the stack. Moves it to top if already present. */
  push: (panel: MainPanel) => void;
  /** Remove a specific panel from the stack wherever it is. Never removes 'documents'. */
  remove: (panel: MainPanel) => void;
}

const MainPanelStackContext = createContext<MainPanelStackContextValue>({
  stack: ['documents'],
  top: 'documents',
  push: () => {},
  remove: () => {},
});

export const useMainPanelStack = () => useContext(MainPanelStackContext);

interface MainPanelStackProviderProps {
  children: React.ReactNode;
  initialStack?: MainPanel[];
}

export const MainPanelStackProvider: React.FC<MainPanelStackProviderProps> = ({ children, initialStack }) => {
  const [stack, setStack] = useState<MainPanel[]>(initialStack ?? ['documents']);

  const top = stack[stack.length - 1];

  const push = useCallback((panel: MainPanel) => {
    setStack((prev) => {
      if (prev[prev.length - 1] === panel) return prev;
      const filtered = prev.filter((p) => p !== panel);
      return [...filtered, panel];
    });
  }, []);

  const remove = useCallback((panel: MainPanel) => {
    if (panel === 'documents') return;
    setStack((prev) => {
      const filtered = prev.filter((p) => p !== panel);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, []);

  const value = useMemo<MainPanelStackContextValue>(
    () => ({ stack, top, push, remove }),
    [stack, top, push, remove],
  );

  return (
    <MainPanelStackContext.Provider value={value}>
      {children}
    </MainPanelStackContext.Provider>
  );
};
