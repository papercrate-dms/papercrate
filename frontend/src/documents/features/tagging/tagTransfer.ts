import type { DocumentId, TagId } from '../../../types/identifiers';
import { TAG_MIME_TYPES, TAG_TEXT_MIME_TYPE } from '../../../constants/documents';

interface TagPayload {
  id: TagId;
  label: string;
  sourceDocId: DocumentId | null;
}

interface TagLike {
  id?: TagId;
  label?: string | null;
}

const serializePayload = (payload: TagPayload): string | null => {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    console.warn('[tagTransfer] Failed to serialize payload', error);
    return null;
  }
};

const createTagTransferPayload = (
  tag?: TagLike | null,
  sourceDocId: DocumentId | null = null,
): TagPayload | null => {
  if (!tag || tag.id == null) {
    return null;
  }

  return {
    id: tag.id,
    label: tag.label || '',
    sourceDocId: sourceDocId ?? null,
  };
};

// Shared state to track dragged tag ID across components (Sidebar <-> Workspace)
// This is necessary because dataTransfer payload is inaccessible during dragOver.
interface ActiveDragState {
  tagId: TagId | null;
  sourceDocId: DocumentId | null;
}

let activeDragState: ActiveDragState = { tagId: null, sourceDocId: null };
interface ActionResult {
  type: 'attach' | 'detach';
  success: boolean;
}


let pendingActions = 0;
let actionResults: ActionResult[] = [];
let toastListener: ((message: string, type: 'success' | 'error' | 'info') => void) | null = null;

const listeners = new Set<(state: ActiveDragState) => void>();

export const getActiveDragState = (): ActiveDragState => activeDragState;

export const subscribeToToast = (callback: (message: string, type: 'success' | 'error' | 'info') => void): () => void => {
  toastListener = callback;
  return () => {
    toastListener = null;
  };
};

export const subscribeToTagDrag = (callback: (state: ActiveDragState) => void): () => void => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};

const processResults = () => {
  if (pendingActions > 0) return;
  if (actionResults.length === 0) return;

  const successes = actionResults.filter(r => r.success);
  const attached = successes.find(r => r.type === 'attach');
  const detached = successes.find(r => r.type === 'detach');

  try {
    if (attached && detached) {
      toastListener?.('Tag moved.', 'success');
    } else if (attached) {
      toastListener?.('Tag assigned.', 'success');
    } else if (detached) {
      toastListener?.('Tag removed.', 'success');
    } else if (actionResults.some(r => !r.success)) {
      // If we only had failures, or partial failures
      toastListener?.('Action failed.', 'error');
    }
  } finally {
    actionResults = [];
  }
};

export const beginAction = (): void => {
  pendingActions++;
};

export const finishAction = (result: ActionResult): void => {
  actionResults.push(result);
  pendingActions--;
  // Use timeout to allow batching if multiple actions finish closely or sequence gaps
  setTimeout(processResults, 50);
};

const notifyListeners = () => {
  listeners.forEach((cb) => cb(activeDragState));
};

export const clearTagTransferData = (): void => {
  activeDragState = { tagId: null, sourceDocId: null };
  notifyListeners();
};

export const writeTagTransferData = (
  dataTransfer: DataTransfer | null,
  tag: TagLike,
  sourceDocId: DocumentId | null = null,
): void => {
  // Track globally for cursor logic
  activeDragState = {
    tagId: tag.id || null,
    sourceDocId: sourceDocId || null,
  };
  notifyListeners();

  if (!dataTransfer) {
    return;
  }

  const payload = createTagTransferPayload(tag, sourceDocId);
  if (!payload) {
    return;
  }

  const serialized = serializePayload(payload);
  if (!serialized) {
    return;
  }

  try {
    TAG_MIME_TYPES.forEach((mime) => {
      dataTransfer.setData(mime, serialized);
    });
    if (payload.label) {
      dataTransfer.setData(TAG_TEXT_MIME_TYPE, payload.label);
    }
  } catch (error) {
    console.warn('[tagTransfer] Failed to write drag data', error);
  }
};

const readTagTransferData = (dataTransfer?: DataTransfer | null): string | null => {
  if (!dataTransfer) {
    return null;
  }

  for (let index = 0; index < TAG_MIME_TYPES.length; index += 1) {
    const type = TAG_MIME_TYPES[index];
    try {
      const raw = dataTransfer.getData(type);
      if (raw) {
        return raw;
      }
    } catch (error) {
      console.warn('[tagTransfer] Failed to read drag data for type', type, error);
    }
  }
  return null;
};

type DragEventLike = DragEvent | DataTransfer | {
  dataTransfer?: DataTransfer | null;
  type?: string;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

export const parseTagTransferPayload = (input: DataTransfer | DragEventLike | null): TagPayload | null => {
  let dataTransfer: DataTransfer | null = null;
  if (input instanceof DataTransfer) {
    dataTransfer = input;
  } else if (input && Object(input) === input && 'dataTransfer' in (input as Record<string, unknown>)) {
    const candidate = (input as { dataTransfer?: DataTransfer | null }).dataTransfer;
    if (candidate) {
      dataTransfer = candidate;
    }
  }
  const raw = readTagTransferData(dataTransfer || null);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as TagPayload;
  } catch (error) {
    console.warn('[tagTransfer] Failed to parse drag payload', error);
  }

  return null;
};

export const isTagTransferEvent = (event?: DragEventLike | null): boolean => {
  if (!event) {
    return false;
  }
  let types: DOMStringList | ReadonlyArray<string> | undefined;
  if (event instanceof DataTransfer) {
    types = event.types;
  } else if (Object(event) === event && 'dataTransfer' in (event as Record<string, unknown>)) {
    const payload = (event as { dataTransfer?: DataTransfer | null }).dataTransfer;
    types = payload?.types;
  }
  if (!types) {
    return false;
  }
  const typeList = Array.isArray(types) ? [...types] : Array.from(types);
  return TAG_MIME_TYPES.some((type) => typeList.includes(type));
};

