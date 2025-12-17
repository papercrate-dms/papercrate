import { MutableRefObject, useEffect } from 'react';

type FolderId = string | 'root' | null;

interface DropOverlayState {
  active: boolean;
  folderName: string | null;
}

interface UseFileDropOptions {
  shellRef: MutableRefObject<HTMLElement | null>;
  currentFolderName: string | null;
  selectedFolder: FolderId;
  handleFileDrop: (dataTransfer: DataTransfer, folderId: FolderId) => Promise<void>;
  hasFiles: (event: DragEvent) => boolean;
  defaultFolderName: string;
  dragCounterRef: MutableRefObject<number>;
  setDropOverlayState: (updater: ((prev: DropOverlayState) => DropOverlayState) | DropOverlayState) => void;
}

const useFileDrop = ({
  shellRef,
  currentFolderName,
  selectedFolder,
  handleFileDrop,
  hasFiles,
  defaultFolderName,
  dragCounterRef,
  setDropOverlayState,
}: UseFileDropOptions) => {

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounterRef.current += 1;
      setDropOverlayState({ active: true, folderName: currentFolderName });
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setDropOverlayState((prev) => ({ ...prev, active: false }));
      }
    };

    const handleDrop = async (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounterRef.current = 0;
      setDropOverlayState((prev) => ({ ...prev, active: false }));
      await handleFileDrop(event.dataTransfer, selectedFolder);
    };

    const dropTarget = shellRef.current;
    if (!dropTarget) {
      return undefined;
    }

    dropTarget.addEventListener('dragenter', handleDragEnter);
    dropTarget.addEventListener('dragover', handleDragOver);
    dropTarget.addEventListener('dragleave', handleDragLeave);
    dropTarget.addEventListener('drop', handleDrop);

    return () => {
      dropTarget.removeEventListener('dragenter', handleDragEnter);
      dropTarget.removeEventListener('dragover', handleDragOver);
      dropTarget.removeEventListener('dragleave', handleDragLeave);
      dropTarget.removeEventListener('drop', handleDrop);
      dragCounterRef.current = 0;
      setDropOverlayState((prev) => ({ ...prev, active: false }));
    };
  }, [
    handleFileDrop,
    currentFolderName,
    defaultFolderName,
    selectedFolder,
    hasFiles,
    shellRef,
    dragCounterRef,
    setDropOverlayState,
  ]);

  return null;
};

export default useFileDrop;
