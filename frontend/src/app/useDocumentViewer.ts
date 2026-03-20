import { useCallback, useRef } from 'react';
import type {
  Dispatch,
  SetStateAction,
} from 'react';
import type { DocumentId } from '../types/identifiers';

type FolderId = DocumentId | 'root';

interface UseDocumentViewerArgs {
  selectedFolder?: FolderId | null;
  locationPathname: string;
  locationSearch: string;
  closeDetailPanel: () => void;
  setActiveViewerId: Dispatch<SetStateAction<DocumentId | null>>;
  setViewerDocumentId: Dispatch<SetStateAction<DocumentId | null>>;
}

interface UseDocumentViewerResult {
  activateViewer: (documentId: DocumentId) => void;
  openDocumentViewer: (documentId: DocumentId, options?: { replace?: boolean }) => void;
  closeDocumentViewer: () => void;
  resetViewerState: () => void;
  /** The path to navigate back to when the viewer closes. */
  viewerReturnPath: string | null;
}

const useDocumentViewer = ({
  selectedFolder,
  locationPathname,
  locationSearch,
  closeDetailPanel,
  setActiveViewerId,
  setViewerDocumentId,
}: UseDocumentViewerArgs): UseDocumentViewerResult => {
  const viewerReturnPathRef = useRef<string | null>(null);

  const resetViewerState = useCallback(() => {
    viewerReturnPathRef.current = null;
  }, []);

  const activateViewer = useCallback(
    (documentId: DocumentId): void => {
      if (!documentId) return;

      if (!viewerReturnPathRef.current) {
        viewerReturnPathRef.current = '/folders';
      }

      setActiveViewerId(documentId);
      setViewerDocumentId(documentId);
    },
    [setActiveViewerId, setViewerDocumentId],
  );

  const openDocumentViewer = useCallback(
    (documentId: DocumentId, { replace = false }: { replace?: boolean } = {}) => {
      if (!documentId) return;
      closeDetailPanel();
      viewerReturnPathRef.current = `${locationPathname}${locationSearch}`;
      setActiveViewerId(documentId);
      setViewerDocumentId(documentId);
    },
    [locationPathname, locationSearch, closeDetailPanel, setActiveViewerId, setViewerDocumentId],
  );

  const closeDocumentViewer = useCallback(
    () => {
      // Note: viewerReturnPathRef is intentionally NOT cleared here.
      // The reactive bridge in DocumentsInner reads it to navigate back
      // after the state change triggers a re-render. It gets overwritten
      // on the next openDocumentViewer call.
      setActiveViewerId(null);
      setViewerDocumentId(null);
    },
    [setActiveViewerId, setViewerDocumentId],
  );

  // Direct-link seeding is handled by useState(routeDocumentId) in useDocumentsWorkspace.
  // No effect needed here — the state is already initialized from the route param on mount.

  // Derive return path for consumers. Falls back to the selected folder.
  const fallback = selectedFolder && selectedFolder !== 'root'
    ? `/folders/${selectedFolder}`
    : '/folders';
  const viewerReturnPath = viewerReturnPathRef.current || fallback;

  return {
    activateViewer,
    openDocumentViewer,
    closeDocumentViewer,
    resetViewerState,
    viewerReturnPath,
  };
};

export default useDocumentViewer;
