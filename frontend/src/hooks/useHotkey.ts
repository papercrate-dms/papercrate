import { useEffect } from 'react';

/**
 * Registers a global keyboard shortcut that fires the callback.
 * Non-meta hotkeys are ignored when an input/textarea/contenteditable is focused.
 * Meta hotkeys (Cmd/Ctrl+key) fire regardless of focus.
 */
export function useHotkey(
  key: string,
  callback: () => void,
  options?: { meta?: boolean },
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasMeta = event.metaKey || event.ctrlKey;
      if (!options?.meta) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      const metaMatch = options?.meta ? hasMeta : !hasMeta;
      if (event.key === key && metaMatch) {
        event.preventDefault();
        callback();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [key, callback, options?.meta]);
}
