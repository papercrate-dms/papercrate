import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DragEvent } from 'react';
import { createDocumentEntryKey, createFolderEntryKey } from '../../../app/entryKey';
import type { FolderNodeId, Identifier } from '../../../types/identifiers';

type FolderInput = FolderNodeId | number;

import type { Document } from '../../../types/documents';

type ApplySelectionFn = (
  keys: string[],
  options?: { anchor: string | null; interactedKeys?: string[] },
) => void;

type HandleEntrySelectionFn = (
  key: string,
  event: { preventDefault?: () => void },
) => void;

interface UseDocumentDragHandlersOptions {
  selectedEntries: string[];
  selectedDocumentIds: Identifier[];
  selectedFolderIds: FolderInput[];
  applySelection: ApplySelectionFn;
  handleEntrySelection: HandleEntrySelectionFn;
  documentLookup: Map<Identifier, Document>;
  setDraggedDocumentIds: (ids: Identifier[] | []) => void;
  setDraggedFolderId: (id: FolderNodeId | null) => void;
  documentsViewMode: string;
}

const useDocumentDragHandlers = ({
  selectedEntries,
  selectedDocumentIds,
  selectedFolderIds,
  applySelection,
  handleEntrySelection,
  documentLookup,
  setDraggedDocumentIds,
  setDraggedFolderId,
  documentsViewMode: _documentsViewMode,
}: UseDocumentDragHandlersOptions) => {
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const normalizedFolderIds = useMemo(
    () => selectedFolderIds.map((id) => (id === 'root' ? 'root' : String(id))) as FolderNodeId[],
    [selectedFolderIds],
  );

  const destroyDragPreview = useCallback(() => {
    const node = dragPreviewRef.current;
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
    dragPreviewRef.current = null;
  }, []);

  useEffect(() => destroyDragPreview, [destroyDragPreview]);

  const createDragPreview = useCallback(
    ({ documents = [], folders = [], prioritizeFolders = false }: { documents?: Document[]; folders?: FolderNodeId[]; prioritizeFolders?: boolean } = {}) => {
      destroyDragPreview();

      const docEntries = (documents || []).filter(Boolean);
      const folderEntries = (folders || []).filter(Boolean);
      const totalCount = docEntries.length + folderEntries.length;
      if (!totalCount) {
        return null;
      }

      const maxVisible = 4;
      const size = 64;
      const canvasSize = Math.round(size * 1.6);

      const visibleItems: Array<{ type: 'document' | 'folder'; payload: any }> = [];

      let takeDocs = 0;
      let takeFolders = 0;

      if (docEntries.length > 0 && folderEntries.length > 0) {
        if (prioritizeFolders) {
          // Folders on top (added last)
          takeDocs = Math.min(docEntries.length, maxVisible - 1);
          takeFolders = Math.min(folderEntries.length, maxVisible - takeDocs);
        } else {
          // Docs on top (added last)
          takeFolders = Math.min(folderEntries.length, maxVisible - 1);
          takeDocs = Math.min(docEntries.length, maxVisible - takeFolders);
        }
      } else {
        takeDocs = Math.min(docEntries.length, maxVisible);
        takeFolders = Math.min(folderEntries.length, maxVisible - takeDocs);
      }

      if (prioritizeFolders) {
        // Docs at bottom
        docEntries.slice(0, takeDocs).forEach((doc) => {
          visibleItems.push({ type: 'document', payload: doc });
        });
        // Folders at top
        folderEntries.slice(0, takeFolders).forEach((folderId) => {
          visibleItems.push({ type: 'folder', payload: folderId });
        });
      } else {
        // Folders at bottom
        folderEntries.slice(0, takeFolders).forEach((folderId) => {
          visibleItems.push({ type: 'folder', payload: folderId });
        });
        // Docs at top
        docEntries.slice(0, takeDocs).forEach((doc) => {
          visibleItems.push({ type: 'document', payload: doc });
        });
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'document-drag-preview';
      wrapper.style.setProperty('--drag-preview-size', `${canvasSize}px`);
      wrapper.style.width = `${canvasSize}px`;
      wrapper.style.height = `${canvasSize}px`;

      visibleItems.forEach((item, index) => {
        const layer = document.createElement('div');
        layer.className = 'document-drag-preview__item';
        layer.style.setProperty('--index', String(index));
        const rotationMagnitude = Math.random() * 8 + 2;
        const rotation = (index % 2 === 0 ? 1 : -1) * rotationMagnitude;
        layer.style.setProperty('--rotation-deg', `${rotation}deg`);

        if (item.type === 'document') {
          const doc = item.payload;
          const rowEl = doc?.id
            ? document.getElementById(`document-${doc.id}`)
            : null;
          const wrapperEl = rowEl instanceof HTMLElement
            ? rowEl.querySelector<HTMLElement>('.document-thumbnail-wrapper')
            : null;
          const thumbnailEl = rowEl instanceof HTMLElement
            ? rowEl.querySelector<HTMLImageElement>('.document-thumbnail')
            : null;
          const placeholderEl = rowEl instanceof HTMLElement
            ? rowEl.querySelector<HTMLElement>('.thumb-placeholder')
            : null;
          const aspectAttr = wrapperEl?.dataset?.thumbnailAspect;
          const aspectRatio = aspectAttr ? parseFloat(aspectAttr) : null;

          let thumbWidth = size;
          let thumbHeight = size;
          if (aspectRatio > 0) {
            if (aspectRatio >= 1) {
              thumbWidth = size;
              thumbHeight = Math.max(size / aspectRatio, size * 0.5);
            } else {
              thumbHeight = size;
              thumbWidth = Math.max(size * aspectRatio, size * 0.5);
            }
          }
          layer.style.width = `${Math.round(thumbWidth)}px`;
          layer.style.height = `${Math.round(thumbHeight)}px`;

          const thumbSrc = thumbnailEl?.currentSrc || thumbnailEl?.src || null;
          if (thumbSrc) {
            layer.classList.add('document-drag-preview__item--image');
            layer.style.backgroundImage = `url("${thumbSrc}")`;
          } else if (placeholderEl instanceof HTMLElement) {
            const clone = placeholderEl.cloneNode(true) as HTMLElement;
            clone.style.pointerEvents = 'none';
            layer.appendChild(clone);
          } else {
            layer.textContent = doc?.title || 'Document';
          }
        } else {
          const payload = item.payload;
          const folderId = payload as FolderNodeId;
          const rowEl = folderId
            ? document.getElementById(`folder-${folderId}`)
            : null;
          const iconEl = rowEl instanceof HTMLElement
            ? rowEl.querySelector('.thumb-icon, .folder-card__icon')
            : null;
          layer.style.width = `${size}px`;
          layer.style.height = `${size}px`;
          layer.classList.add('document-drag-preview__item--folder');

          let content: HTMLElement | SVGElement | null = null;
          if (iconEl instanceof HTMLElement) {
            const cloneSource = iconEl.classList.contains('folder-card__icon')
              ? iconEl.querySelector('svg') || iconEl
              : iconEl;
            const clone = cloneSource.cloneNode(true);
            if (clone instanceof HTMLElement || clone instanceof SVGElement) {
              content = clone as HTMLElement | SVGElement;
              content.classList.add('document-drag-preview__folder-thumb');
              const svg = content.nodeName.toLowerCase() === 'svg'
                ? content
                : content.querySelector('svg');
              if (svg) {
                svg.setAttribute('width', '48');
                svg.setAttribute('height', '48');
              }
            }
          }

          if (!content) {
            content = document.createElement('div');
            content.className = 'document-drag-preview__folder-placeholder';
            content.textContent = 'Folder';
          }

          layer.appendChild(content);
        }

        wrapper.appendChild(layer);
      });

      if (totalCount > 1) {
        const badge = document.createElement('div');
        badge.className = 'document-drag-preview__count';
        badge.textContent = `${totalCount}`;
        wrapper.appendChild(badge);
      }

      document.body.appendChild(wrapper);
      dragPreviewRef.current = wrapper;
      return wrapper;
    },
    [destroyDragPreview],
  );

  const handleDocumentDragStart = useCallback(
    (event: DragEvent<HTMLElement>, documentOrId: Document | Identifier | null) => {
      const documentId: Identifier | null = Object(documentOrId) === documentOrId
        ? (documentOrId as Document)?.id ?? null
        : (documentOrId as Identifier | null);
      if (!documentId) {
        return;
      }

      const documentKey = createDocumentEntryKey(documentId);
      if (!documentKey) {
        return;
      }

      const isAlreadySelected = selectedDocumentIds.includes(documentId);
      const selection: Identifier[] = isAlreadySelected
        ? [...selectedDocumentIds]
        : [documentId];

      // If the document is part of the selection, we also want to include any selected folders
      const folderSelection: FolderNodeId[] = isAlreadySelected
        ? normalizedFolderIds
        : [];

      if (!isAlreadySelected) {
        applySelection([documentKey], {
          anchor: documentKey,
          interactedKeys: [documentKey],
        });
      }

      const previewDocs = selection
        .map((id) => documentLookup.get(id) || documentLookup.get(String(id)) || null)
        .filter(Boolean);
      const previewNode = createDragPreview({
        documents: previewDocs,
        folders: folderSelection,
        prioritizeFolders: false,
      });

      setDraggedDocumentIds(selection);
      if (folderSelection.length) {
        setDraggedFolderId(folderSelection[0] || null);
      }
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData(
          'application/x-papercrate-doc-list',
          JSON.stringify(selection),
        );
        if (folderSelection.length) {
          event.dataTransfer.setData(
            'application/x-papercrate-folder-list',
            JSON.stringify(folderSelection),
          );
          if (folderSelection.length === 1) {
            event.dataTransfer.setData('application/x-papercrate-folder', folderSelection[0]);
          }
        }
      } catch (error) {
        console.warn('[documents] Failed to populate drag payload', error);
      }
      if (previewNode) {
        const width = previewNode.offsetWidth || 96;
        const height = previewNode.offsetHeight || 96;
        event.dataTransfer.setDragImage(previewNode, width / 2, height / 2);
      }
      event.currentTarget.classList.add('dragging');
    },
    [
      selectedDocumentIds,
      applySelection,
      documentLookup,
      createDragPreview,
      setDraggedFolderId,
      setDraggedDocumentIds,
      normalizedFolderIds,
    ],
  );

  const handleDocumentDragEnd = useCallback(
    (event: DragEvent<HTMLElement>) => {
      setDraggedDocumentIds([]);
      event.currentTarget.classList.remove('dragging');
      destroyDragPreview();
      setDraggedFolderId(null);
    },
    [destroyDragPreview, setDraggedFolderId, setDraggedDocumentIds],
  );

  const handleFolderDragStart = useCallback(
    (event: DragEvent<HTMLElement>, folderId: FolderInput) => {
      const normalizedFolderId: FolderNodeId = folderId === 'root' ? 'root' : String(folderId);
      if (normalizedFolderId === 'root') {
        return;
      }
      event.stopPropagation();
      const folderKey = createFolderEntryKey(normalizedFolderId);
      const isAlreadySelected = folderKey ? selectedEntries.includes(folderKey) : false;

      let effectiveFolderSelection: FolderNodeId[] = normalizedFolderIds;
      let effectiveDocumentSelection: Identifier[] = selectedDocumentIds;

      if (!isAlreadySelected && folderKey) {
        effectiveFolderSelection = [normalizedFolderId];
        effectiveDocumentSelection = [];
        handleEntrySelection(folderKey, { preventDefault: () => { } });
      }

      const uniqueFolders = effectiveFolderSelection.length
        ? Array.from(new Set(effectiveFolderSelection.filter(Boolean)))
        : [normalizedFolderId];

      setDraggedFolderId(normalizedFolderId);
      if (effectiveDocumentSelection.length) {
        setDraggedDocumentIds(effectiveDocumentSelection);
      }

      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData(
          'application/x-papercrate-folder-list',
          JSON.stringify(uniqueFolders),
        );
        if (uniqueFolders.length === 1) {
          event.dataTransfer.setData('application/x-papercrate-folder', uniqueFolders[0]);
        }
        if (effectiveDocumentSelection.length) {
          event.dataTransfer.setData(
            'application/x-papercrate-doc-list',
            JSON.stringify(effectiveDocumentSelection),
          );
        }
      } catch (error) {
        console.warn('[documents] Failed to populate folder drag payload', error);
      }

      const previewNode = createDragPreview({
        documents: effectiveDocumentSelection
          .map((id) => documentLookup.get(id) || documentLookup.get(String(id)) || null)
          .filter(Boolean),
        folders: uniqueFolders,
        prioritizeFolders: true,
      });
      event.currentTarget.classList.add('dragging');

      if (previewNode) {
        const width = previewNode.offsetWidth || 96;
        const height = previewNode.offsetHeight || 96;
        event.dataTransfer.setDragImage(previewNode, width / 2, height / 2);
      }
    },
    [
      normalizedFolderIds,
      selectedEntries,
      selectedDocumentIds,
      handleEntrySelection,
      setDraggedFolderId,
      setDraggedDocumentIds,
      documentLookup,
      createDragPreview,
    ],
  );

  const handleFolderDragEnd = useCallback(
    (event?: DragEvent<HTMLElement>) => {
      if (event?.currentTarget) {
        event.currentTarget.classList.remove('dragging');
      }
      setDraggedFolderId(null);
      setDraggedDocumentIds([]);
      destroyDragPreview();
    },
    [setDraggedFolderId, setDraggedDocumentIds, destroyDragPreview],
  );

  return {
    handleDocumentDragStart,
    handleDocumentDragEnd,
    handleFolderDragStart,
    handleFolderDragEnd,
  };
};

export default useDocumentDragHandlers;
