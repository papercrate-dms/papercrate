import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStatusToast } from '../lib/context/StatusToastContext';
import TagsPanel from '../tags/TagsPanel';
import CorrespondentsPanel, { CorrespondentsPanelProps } from '../correspondents/CorrespondentsPanel';
import PanelHeader from '../components/PanelHeader';
import { CloseIcon, RefreshIcon } from '../components/icons';
import { CORRESPONDENTS_MODAL, TAGS_MODAL } from '../constants/app';
import type { Tag, Correspondent } from '../types/documents';


interface UseManagementModalsArgs {
  locationPathname?: string;
  tags?: Tag[];
  refreshTags?: () => void | Promise<void>;
  onTagCreate?: (payload: { label: string; color: string | null }) => Promise<void>;
  onTagUpdate?: (id: string, payload: { label: string; color: string | null }) => Promise<void>;
  onTagDelete?: (id: string) => Promise<void>;
  correspondents?: Correspondent[];
  refreshCorrespondents?: () => void | Promise<void>;
  onCorrespondentCreate?: (payload: { name: string }) => Promise<Correspondent | void>;
  onCorrespondentUpdate?: (id: string, payload: { name: string }) => Promise<void>;
  onCorrespondentDelete?: (id: string) => Promise<void>;
}

interface UseManagementModalsResult {
  managementModals: ReactNode;
  openTagsModal: () => void;
  openCorrespondentsModal: () => void;
  closeActiveModal: () => void;
  activeModal: string | null;
}

export const useManagementModals = ({
  locationPathname,
  tags = [],
  refreshTags,
  onTagCreate,
  onTagUpdate,
  onTagDelete,
  correspondents = [],
  refreshCorrespondents,
  onCorrespondentCreate,
  onCorrespondentUpdate,
  onCorrespondentDelete,
}: UseManagementModalsArgs): UseManagementModalsResult => {
  const { showToast } = useStatusToast();
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const openTagsModal = useCallback(() => setActiveModal(TAGS_MODAL), []);
  const openCorrespondentsModal = useCallback(
    () => setActiveModal(CORRESPONDENTS_MODAL),
    [],
  );
  const closeActiveModal = useCallback(() => setActiveModal(null), []);

  useEffect(() => {
    setActiveModal(null);
  }, [locationPathname]);

  useEffect(() => {
    if (!activeModal) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal]);

  const tagModal = useMemo(() => {
    if (activeModal !== TAGS_MODAL) {
      return null;
    }
    return (
      <div
        className="modal-backdrop"
        role="presentation"
        onClick={closeActiveModal}
      >
        <div
          className="modal modal--panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tags-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <PanelHeader
            className="panel-modal__header"
            title="Manage Tags"
            titleTag="h3"
            titleProps={{ id: 'tags-modal-title' }}
            actions={(
              <>
                {refreshTags ? (
                  <button type="button" className="icon-button" onClick={refreshTags} aria-label="Refresh">
                    <RefreshIcon size={16} />
                  </button>
                ) : null}
                <button type="button" className="icon-button" onClick={closeActiveModal} aria-label="Close">
                  <CloseIcon size={16} />
                </button>
              </>
            )}
          />
          <div className="panel-modal__body">
            <TagsPanel
              tags={tags}
              onCreateTag={onTagCreate}
              onUpdateTag={onTagUpdate}
              onDeleteTag={onTagDelete}
              onNotify={showToast}
            />
          </div>
        </div>
      </div>
    );
  }, [
    activeModal,
    closeActiveModal,
    onTagCreate,
    onTagDelete,
    onTagUpdate,
    refreshTags,
    showToast,
    tags,
  ]);





  const correspondentsModal = useMemo(() => {
    if (activeModal !== CORRESPONDENTS_MODAL) {
      return null;
    }
    return (
      <div
        className="modal-backdrop"
        role="presentation"
        onClick={closeActiveModal}
      >
        <div
          className="modal modal--panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correspondents-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <PanelHeader
            className="panel-modal__header"
            title="Manage Correspondents"
            titleTag="h3"
            titleProps={{ id: 'correspondents-modal-title' }}
            actions={(
              <>
                {refreshCorrespondents ? (
                  <button type="button" className="icon-button" onClick={refreshCorrespondents} aria-label="Refresh">
                    <RefreshIcon size={16} />
                  </button>
                ) : null}
                <button type="button" className="icon-button" onClick={closeActiveModal} aria-label="Close">
                  <CloseIcon size={16} />
                </button>
              </>
            )}
          />
          <div className="panel-modal__body">
            <CorrespondentsPanel
              correspondents={correspondents}
              onCreate={onCorrespondentCreate as CorrespondentsPanelProps['onCreate']}
              onUpdate={onCorrespondentUpdate as CorrespondentsPanelProps['onUpdate']}
              onDelete={onCorrespondentDelete as CorrespondentsPanelProps['onDelete']}
              onNotify={showToast}
            />
          </div>
        </div>
      </div>
    );
  }, [
    activeModal,
    closeActiveModal,
    correspondents,
    onCorrespondentCreate,
    onCorrespondentDelete,
    onCorrespondentUpdate,
    refreshCorrespondents,
    showToast,
  ]);

  const managementModals = (
    <>
      {tagModal}
      {correspondentsModal}
    </>
  );

  return {
    managementModals,
    openTagsModal,
    openCorrespondentsModal,
    closeActiveModal,
    activeModal,
  };
};
