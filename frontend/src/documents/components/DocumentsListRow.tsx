import React from 'react';
import { FolderIcon } from '../../components/icons';
import { formatDate } from '../../utils/date';
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

interface DocumentsListRowProps {
    entry: DocumentsListEntry;
    viewLogic: DocumentViewLogic;
    iconSize?: number;
    tagHandlers?: TagInteractionHandlers;
}

const DocumentsListRow: React.FC<DocumentsListRowProps> = (props) => {
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
                component="tr"
                className="folder"
            >
                {(logic) => (
                    <>
                        <td className="thumb-cell">
                            <div className="thumb-icon">
                                <FolderIcon className="thumb-icon__image" size={iconSize || 32} />
                            </div>
                        </td>
                        <td className="doc-list__name">
                            <div className="doc-list__name-content">
                                <span className="doc-name__title">
                                    <span className="doc-name__primary">
                                         <EditableEntryTitle
                                            rename={logic.folderRenameProps}
                                            className="doc-name__primary-text"
                                        >
                                            {folder.name}
                                        </EditableEntryTitle>
                                    </span>
                                </span>
                            </div>
                        </td>
                        <td>—</td>
                        <td>—</td>
                    </>
                )}
            </FolderEntry>
        );
    }

    const doc = entry.document;
    if (!doc) return null;

    const correspondents = resolveCorrespondents(doc, correspondentLookupById);
    const issuedLabel = formatDate(doc.issued_at);
    const addedLabel = formatDate(doc.created_at || doc.uploaded_at);

    return (
        <DocumentEntry
            doc={doc}
            tagHandlers={tagHandlers}
            viewLogic={props.viewLogic}
            component="tr"
            className="document"
        >
            {(logic) => (
                <>
                    <td className="thumb-cell">
                        <DocumentThumbnailImage
                            document={doc}
                            ensureAssetUrl={ensureAssetUrl}
                            getAsset={getDocumentAsset}
                            alt={`Thumbnail for ${doc.title}`}
                            scrollRootRef={scrollRef}
                            maxSize={props.iconSize}
                        />
                    </td>
                    <td className="doc-list__name">
                        <div className="doc-name">
                            <div className="doc-list__name-content">
                                <span className="doc-name__title">
                                    <EntryCorrespondents
                                        correspondents={correspondents}
                                        activeCorrespondentIdSet={activeCorrespondentIdSet}
                                        onCorrespondentClick={onCorrespondentClick}
                                    />
                                    <span className="doc-name__primary">
                                        <EditableEntryTitle
                                            rename={logic.documentRenameProps}
                                            className="doc-name__primary-text"
                                        >
                                            {doc.title}
                                        </EditableEntryTitle>
                                    </span>
                                </span>
                            </div>
                            <div className="doc-name__tags">
                                <DocumentTags
                                    tags={doc.tags || []}
                                    tagLookupById={tagLookupById}
                                    doc={doc}
                                    tagHandlers={logic.handlers.tagHandlers}
                                />
                            </div>
                        </div>
                    </td>
                    <td>{issuedLabel}</td>
                    <td>{addedLabel}</td>
                </>
            )}
        </DocumentEntry>
    );
};


export default DocumentsListRow;
