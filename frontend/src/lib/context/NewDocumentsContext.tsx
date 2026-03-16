import React, { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import type { DocumentId } from '../../types/identifiers';

const STORAGE_KEY = 'papercrate:new-documents';

function readIds(): Set<DocumentId> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as DocumentId[]);
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<DocumentId>) {
  try {
    if (ids.size === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    }
  } catch {
    // sessionStorage unavailable
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = readIds();

function notify() {
  snapshot = readIds();
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): Set<DocumentId> {
  return snapshot;
}

export function markNew(ids: DocumentId[]) {
  if (!ids.length) return;
  const current = readIds();
  ids.forEach((id) => current.add(id));
  writeIds(current);
  notify();
}

function clearNew(id: DocumentId) {
  const current = readIds();
  if (!current.has(id)) return;
  current.delete(id);
  writeIds(current);
  notify();
}

function clearAll() {
  writeIds(new Set());
  notify();
}

interface NewDocumentsContextValue {
  newDocumentIds: Set<DocumentId>;
  markNew: (ids: DocumentId[]) => void;
  clearNew: (id: DocumentId) => void;
  clearAll: () => void;
  isNew: (id: DocumentId) => boolean;
}

const NewDocumentsContext = createContext<NewDocumentsContextValue | null>(null);

export const NewDocumentsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const newDocumentIds = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const isNew = useCallback((id: DocumentId) => newDocumentIds.has(id), [newDocumentIds]);

  const value = useMemo<NewDocumentsContextValue>(() => ({
    newDocumentIds,
    markNew,
    clearNew,
    clearAll,
    isNew,
  }), [newDocumentIds, isNew]);

  return (
    <NewDocumentsContext.Provider value={value}>
      {children}
    </NewDocumentsContext.Provider>
  );
};

export function useNewDocuments(): NewDocumentsContextValue {
  const ctx = useContext(NewDocumentsContext);
  if (!ctx) throw new Error('useNewDocuments must be used within NewDocumentsProvider');
  return ctx;
}
