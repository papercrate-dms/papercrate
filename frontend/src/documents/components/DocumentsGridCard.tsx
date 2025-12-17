import React from 'react';
import { FolderIcon } from '../../components/icons';
import DocumentThumbnailImage from '../DocumentThumbnailImage';
import { resolveCorrespondents } from '../correspondents';
import type { DocumentsListEntry } from '../../types/documents';
import { useDocumentsAssetContext } from '../context/DocumentsAssetContext';
import { useDocumentsViewStateContext } from '../context/DocumentsViewStateContext';
import { useDocumentsCommandContext } from '../context/DocumentsCommandContext';
import type { DocumentViewLogic } from '../logic/useDocumentViewLogic';
import EditableEntryTitle from './EditableEntryTitle';
import EntryCorrespondents from './EntryCorrespondents';
import DocumentTags from './DocumentTags';
import FolderEntry from './FolderEntry';
import DocumentEntry from './DocumentEntry';
import { TagInteractionHandlers } from '../interactions/useTagInteractions';

interface DocumentsGridCardProps {
    entry: DocumentsListEntry;
    viewLogic: DocumentViewLogic;
    iconSize?: number;
    tagHandlers?: TagInteractionHandlers;
}

const DocumentsGridCard: React.FC<DocumentsGridCardProps> = (props) => {
    const { entry, iconSize, tagHandlers } = props;
    const { ensureAssetUrl, getDocumentAsset } = useDocumentsAssetContext();
    const { scrollRef, activeCorrespondentIdSet, tagLookupById, correspondentLookupById } = useDocumentsViewStateContext();
    const {
        correspondents: { onClick: onCorrespondentClick },
    } = useDocumentsCommandContext();

    if (entry.type === 'folder') {
        const folder = entry.folder;
        if (!folder) return null;

        return (
            <FolderEntry
                folder={folder}
                viewLogic={props.viewLogic}
                component="div"
                className="document-card folder-card"
                role="listitem"
            >
                {(logic) => (
                    <>
                        <div className="folder-card__icon">
                            <FolderIcon className="folder-card__icon-svg" size={iconSize} />
                        </div>
                        <div className="folder-card__meta">
                            <div className="folder-card__label-row">
                                <EditableEntryTitle
                                    isEditing={logic.isFolderEditing}
                                    draftValue={logic.folderDraftValue}
                                    onChange={logic.handlers.onRenameChange}
                                    onSubmit={logic.handlers.onRenameSubmit}
                                    onCancel={logic.handlers.onRenameCancel}
                                    isSaving={logic.isFolderSaving}
                                    canSubmit={logic.canSubmitFolder}
                                    inputRef={logic.attachFolderInputRef}
                                    allowInlineEdit={logic.allowInlineFolderEdit}
                                    onBeginEditing={logic.handlers.onRenameBegin}
                                    className="folder-card__name"
                                >
                                    {folder.name}
                                </EditableEntryTitle>
                            </div>
                        </div>
                    </>
                )}
            </FolderEntry>
        );
    }

    const doc = entry.document;
    if (!doc) return null;

    const correspondents = resolveCorrespondents(doc, correspondentLookupById);

    return (
        <DocumentEntry
            doc={doc}
            tagHandlers={tagHandlers}
            viewLogic={props.viewLogic}
            component="div"
            className="document-card document"
            role="listitem"
        >
            {(logic) => (
                <>
                    <DocumentThumbnailImage
                        document={doc}
                        ensureAssetUrl={ensureAssetUrl}
                        getAsset={getDocumentAsset}
                        alt={`Thumbnail for ${doc.title}`}
                        maxSize={iconSize}
                        scrollRootRef={scrollRef}
                    />
                    <div className="document-card__meta">
                        <div className="document-card__title" title={doc.title}>
                            <EntryCorrespondents
                                correspondents={correspondents}
                                activeCorrespondentIdSet={activeCorrespondentIdSet}
                                onCorrespondentClick={onCorrespondentClick}
                            />
                            <div className="document-card__title-row">
                                <EditableEntryTitle
                                    isEditing={logic.isEditingDoc}
                                    draftValue={logic.documentDraftValue}
                                    onChange={logic.handlers.onRenameChange}
                                    onSubmit={logic.handlers.onRenameSubmit}
                                    onCancel={logic.handlers.onRenameCancel}
                                    isSaving={logic.isDocumentSaving}
                                    canSubmit={logic.canSubmitDocument}
                                    inputRef={logic.attachDocumentInputRef}
                                    allowInlineEdit={logic.allowInlineDocumentEdit}
                                    onBeginEditing={logic.handlers.onRenameBegin}
                                    className="document-card__title-badge"
                                >
                                    {doc.title}
                                </EditableEntryTitle>
                            </div>
                        </div>
                        <div className="document-card__tags">
                            <DocumentTags
                                tags={doc.tags || []}
                                tagLookupById={tagLookupById}
                                doc={doc}
                                tagHandlers={logic.handlers.tagHandlers}
                            />
                        </div>
                    </div>
                </>
            )}
        </DocumentEntry>
    );
};


export default DocumentsGridCard;
