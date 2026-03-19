import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
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
  ensureAssetUrl: (documentId: DocumentId, asset: Asset, options?: { force?: boolean }) => Promise<unknown>;
  getDocumentAsset: (doc: Document | null, type: string) => Asset | null;

  // Detail panel
  detailPanelProps: unknown;
  detailPanelOpen: boolean;
  openDetailPanel: (documentId: Identifier) => void;
  closeDetailPanel: () => void;
}

const [DocumentsWorkspaceCtx, useDocumentsWorkspaceContext] = createSafeContext<DocumentsWorkspaceContextValue>('DocumentsWorkspace');

export const DocumentsWorkspaceProvider: React.FC<{ value: DocumentsWorkspaceContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <DocumentsWorkspaceCtx.Provider value={value}>{children}</DocumentsWorkspaceCtx.Provider>
);

export { useDocumentsWorkspaceContext };
