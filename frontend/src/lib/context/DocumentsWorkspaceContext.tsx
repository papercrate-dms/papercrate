import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import { useDocumentsSearch as useSearchContext } from './DocumentsSearchContext';
import { useFolder } from './FolderContext';
import useWorkspaceSelectionSync from '../../documents/features/selection/useWorkspaceSelectionSync';
import useDocumentsSelection from '../../documents/features/selection/useDocumentsSelection';
import type { MutableRefObject } from 'react';
import type { DocumentId, Identifier } from '../../types/identifiers';
import type { Document } from '../../types/documents';
import type { Asset } from '../../types/assets';

export interface DocumentsWorkspaceContextValue {
  // Selection
  clearDocumentSelection: () => void;
  handleDeleteSelection: () => Promise<void> | void;
  handleEntryPointerCore: (entry: unknown, event: unknown) => void;
  handleBulkSelectionReanalyze: (...args: unknown[]) => Promise<void> | void;
  selectionValue: unknown;

  // Mutations
  handleDocumentDragStart: (event: React.DragEvent<HTMLElement>, doc: Document) => void;
  handleDocumentDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  draggedDocumentIds: DocumentId[];
  handleDocumentTitleUpdate: (...args: unknown[]) => unknown;
  handleDocumentIssuedUpdate: (...args: unknown[]) => unknown;
  handleDocumentTagAdd: (...args: unknown[]) => unknown;
  handleDocumentTagAttach: (...args: unknown[]) => unknown;
  handleDocumentTagDetach: (...args: unknown[]) => unknown;

  // Preview / viewer
  openDocumentViewerForDetail: (args?: { documentIds?: Identifier[] }) => void;
  viewerActive: boolean;
  viewerDocumentId: DocumentId | null;
  closeDocumentViewer: () => void;
  viewerReturnPath: string | null;
  ensureAssetUrl: (documentId: DocumentId, asset: Asset, options?: { force?: boolean }) => Promise<unknown>;
  getDocumentAsset: (doc: Document | null, type: string) => Asset | null;

  // Detail panel
  detailPanelProps: unknown;
  detailPanelOpen: boolean;
  openDetailPanel: (documentId: Identifier) => void;
  closeDetailPanel: () => void;
}

const [DocumentsWorkspaceCtx, useDocumentsWorkspaceContext] = createSafeContext<DocumentsWorkspaceContextValue>('DocumentsWorkspace');

/** Selection state props passed from the workspace orchestrator (useDocumentsWorkspace). */
export interface WorkspaceSelectionProps {
  selectedEntries: string[];
  selectedDocumentIds: Identifier[];
  setSelectedEntries: (entries: string[]) => void;
  setSelectionOrder: (order: string[]) => void;
  selectionOrderRef: MutableRefObject<string[] | null>;
  selectionAnchorRef: MutableRefObject<string | null>;
  setFocusedDocumentId: (id: Identifier | null) => void;
  focusedDocumentId: Identifier | null;
  setFocusedEntryKey: (key: string | null) => void;
  focusedEntryKey: string | null;
  selectionInitializedRef: MutableRefObject<boolean>;
  activeViewerId: Identifier | null;
  setActiveViewerId: (id: Identifier | null) => void;
  configureSelectionEnvironment: (...args: unknown[]) => void;
  promoteSelectionOrderRaw: (...args: unknown[]) => void;
  clearSelection: () => void;
}

export interface DocumentsWorkspaceProviderProps {
  /** Pre-assembled value for fields owned by the orchestrator (mutations, viewer, drag, etc.) */
  value: Omit<DocumentsWorkspaceContextValue, 'clearDocumentSelection'>;
  /** Selection state from useWorkspaceSelection */
  selection: WorkspaceSelectionProps;
  children: React.ReactNode;
}

export const DocumentsWorkspaceProvider: React.FC<DocumentsWorkspaceProviderProps> = ({
  value,
  selection,
  children,
}) => {
  // Read search + folder state from context (above us in the stack).
  const search = useSearchContext();
  const folder = useFolder();

  const showingSearchResults = search.showingSearchResults;

  // Sync selection with search state changes (clear on new search).
  useWorkspaceSelectionSync({
    showingSearchResults,
    searchQuery: search.searchQuery,
    setSelectedEntries: selection.setSelectedEntries,
    setSelectionOrder: selection.setSelectionOrder,
    selectionOrderRef: selection.selectionOrderRef,
    selectionAnchorRef: selection.selectionAnchorRef,
    setFocusedDocumentId: selection.setFocusedDocumentId,
    selectedDocumentIds: selection.selectedDocumentIds,
    activeViewerId: selection.activeViewerId,
    setActiveViewerId: selection.setActiveViewerId,
    selectionInitializedRef: selection.selectionInitializedRef,
  });

  // Configure selection environment with visible entries.
  const selectionContext = useDocumentsSelection({
    showingSearchResults,
    currentSubfolders: folder.visibleSubfolders,
    visibleDocuments: search.documents as any,
    configureSelectionEnvironment: selection.configureSelectionEnvironment,
    visibleEntryKeySet: search.visibleEntryKeySet,
    selectedEntries: selection.selectedEntries,
    selectionAnchorRef: selection.selectionAnchorRef,
    promoteSelectionOrderRaw: selection.promoteSelectionOrderRaw,
    setFocusedDocumentId: selection.setFocusedDocumentId,
    setActiveViewerId: selection.setActiveViewerId,
    clearSelection: selection.clearSelection,
    focusedDocumentId: selection.focusedDocumentId,
    setFocusedEntryKey: selection.setFocusedEntryKey,
    focusedEntryKey: selection.focusedEntryKey,
  });

  const merged: DocumentsWorkspaceContextValue = {
    ...value,
    clearDocumentSelection: selectionContext.clearDocumentSelection,
  };

  return <DocumentsWorkspaceCtx.Provider value={merged}>{children}</DocumentsWorkspaceCtx.Provider>;
};

export { useDocumentsWorkspaceContext };
