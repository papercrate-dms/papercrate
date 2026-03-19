import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

interface SearchPanelContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  focusInput: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

const SearchPanelContext = createContext<SearchPanelContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  focusInput: () => {},
  inputRef: { current: null },
});

export const useSearchPanel = () => useContext(SearchPanelContext);

export const SearchPanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  const value = useMemo<SearchPanelContextValue>(
    () => ({ isOpen, open, close, toggle, focusInput, inputRef }),
    [isOpen, open, close, toggle, focusInput],
  );

  return (
    <SearchPanelContext.Provider value={value}>
      {children}
    </SearchPanelContext.Provider>
  );
};
