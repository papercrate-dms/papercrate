import type { DocumentId } from '../../types/identifiers';
import { DB_NAME, DB_VERSION, LAYOUT_STORE } from '../../constants/desktop';
type TenantId = import('../../types/identifiers').TenantId;

const currentDbPromise: { value: Promise<IDBDatabase | null> | null } = { value: null };

const openDatabase = (): Promise<IDBDatabase> => {
  if (currentDbPromise.value) {
    return currentDbPromise.value as Promise<IDBDatabase>;
  }

  currentDbPromise.value = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LAYOUT_STORE)) {
        const store = db.createObjectStore(LAYOUT_STORE, {
          keyPath: ['tenantId', 'viewId', 'documentId'],
        });
        store.createIndex('tenantViewIdx', ['tenantId', 'viewId'], { unique: false });
        store.createIndex('tenantIdx', 'tenantId', { unique: false });
        store.createIndex('updatedIdx', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });

  return currentDbPromise.value as Promise<IDBDatabase>;
};

const requestToPromise = <T>(request: IDBRequest<T>, defaultValue: T): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const { result } = request;
      resolve(result ?? defaultValue);
    };
    request.onerror = () => {
      reject(request.error || new Error('IndexedDB request failed'));
    };
  });

const transactionComplete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error || new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error || new Error('IndexedDB transaction aborted'));
    };
  });

type TransactionMode = 'readonly' | 'readwrite' | 'versionchange';

const withStore = async <T>(mode: TransactionMode, handler: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T): Promise<T> => {
  const db = await openDatabase();
  const transaction = db.transaction(LAYOUT_STORE, mode);
  const store = transaction.objectStore(LAYOUT_STORE);
  const done = transactionComplete(transaction);
  try {
    const result = await handler(store, transaction);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch (abortError) {
      console.warn('[desk] Failed to abort transaction', abortError);
    }
    try {
      await done;
    } catch {
      // ignore
    }
    throw error;
  }
};

interface LayoutRecord {
  tenantId: TenantId;
  viewId: string;
  documentId: DocumentId;
  centerX?: number;
  centerY?: number;
  rotation?: number;
  zIndex?: number;
  updatedAt?: number;
}

export const fetchLayoutRecords = async ({
  tenantId,
  viewId,
}: {
  tenantId?: TenantId;
  viewId?: string;
}): Promise<LayoutRecord[]> => {
  if (!tenantId || !viewId) {
    return [];
  }

  try {
    return await withStore('readonly', (store) => {
      const index = store.index('tenantViewIdx');
      return requestToPromise(index.getAll([tenantId, viewId]), []);
    });
  } catch (error) {
    console.warn('[desk] Failed to read layout records', error);
    return [];
  }
};

export const upsertLayoutRecords = async ({
  tenantId,
  viewId,
  entries,
}: {
  tenantId?: TenantId;
  viewId?: string;
  entries?: Array<{
    documentId?: DocumentId;
    centerX?: number;
    centerY?: number;
    rotation?: number;
    zIndex?: number;
    updatedAt?: number;
  }>;
}) => {
  if (!tenantId || !viewId || !Array.isArray(entries) || !entries.length) {
    return;
  }

  try {
    await withStore('readwrite', (store) => {
      const timestamp = Date.now();
      entries.forEach((entry) => {
        if (!entry || !entry.documentId) {
          return;
        }
        store.put({
          tenantId,
          viewId,
          documentId: entry.documentId,
          centerX: Number(entry.centerX) || 0,
          centerY: Number(entry.centerY) || 0,
          rotation: Number(entry.rotation) || 0,
          zIndex: Number(entry.zIndex) || 0,
          updatedAt: entry.updatedAt || timestamp,
        } satisfies LayoutRecord);
      });
    });
  } catch (error) {
    console.warn('[desk] Failed to upsert layout records', error);
  }
};
