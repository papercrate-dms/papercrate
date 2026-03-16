import { useCallback } from 'react';
import type { DocumentId } from '../../types/identifiers';
import type { Document, Tag } from '../../types/documents';
import {
    addDocumentTags,
    deleteDocumentTag,
} from '../../lib/api/apiClient';
import type { TagsState, DocumentsState } from '../types/workspaceTypes';

interface DocumentTagExtras {
    option?: Tag | null;
    input?: { value?: string } | null;
}

interface UseDocumentTagMutationsArgs {
    tagsState: TagsState;
    documentsState: Pick<DocumentsState, 'documentsManager'>;
}

export const useDocumentTagMutations = ({
    tagsState,
    documentsState,
}: UseDocumentTagMutationsArgs) => {
    // Note: Toasts are handled by the caller, e.g. useDetailWorkspace or ResultQueue.

    const attachTagToDocument = useCallback(
        async ({
            documentId,
            tag,
        }: {
            documentId?: DocumentId;
            tag?: Tag | null;
        }) => {
            if (!documentId || !tag?.id) {
                return false;
            }

            await addDocumentTags(documentId, [tag.id]);
            documentsState.documentsManager.map((doc) => {
                if (doc.id !== documentId) {
                    return undefined;
                }
                const currentTags = Array.isArray(doc.tags) ? doc.tags : [];

                if (currentTags.includes(tag.id)) {
                    return doc;
                }
                return { ...doc, tags: [...currentTags, tag.id] };
            });

            return true;
        },
        [documentsState],
    );

    const handleDocumentTagAdd = useCallback(
        async (document: Document, label: string, extras?: DocumentTagExtras | null) => {
            const normalizedLabel = tagsState.tagManager.normalizeLabel(label);
            const optionCandidate = extras?.option ?? null;
            const input = extras?.input ?? null;

            let tag: Tag | null = null;
            // Lookup via ID
            if (optionCandidate && optionCandidate.id) {
                tag = tagsState.tagLookupById.get(optionCandidate.id) || (optionCandidate as Tag);
            }
            // Lookup via Label if not found
            if (!tag) {
                const knownTags = Array.from(tagsState.tagLookupById.values());
                tag = knownTags.find((item) => item.label?.toLowerCase() === normalizedLabel.toLowerCase()) || null;
            }

            // Create tag if needed. Errors bubble up.
            if (!tag) {
                const payload = tagsState.tagManager.buildPayload({ label: normalizedLabel });
                tag = await tagsState.tagManager.create(payload);
                await tagsState.refreshTags();
            }
            await attachTagToDocument({
                documentId: document.id as DocumentId,
                tag,
            });
            if (input && typeof input === 'object' && 'value' in input) {
                (input as { value?: string }).value = '';
            }
        },
        [tagsState, attachTagToDocument],
    );

    const handleDocumentTagAttach = useCallback(
        async (documentId: DocumentId, tagId: DocumentId) => {
            if (!documentId || !tagId) {
                return false;
            }

            const resolveTagForCache = (): Tag | null => {
                const lookupTag = tagsState.tagLookupById.get(tagId);
                if (!lookupTag || lookupTag.id == null) {
                    return null;
                }

                return lookupTag;
            };

            const resolvedTag = resolveTagForCache();
            return attachTagToDocument({
                documentId,
                tag: resolvedTag,
            });
        },
        [
            attachTagToDocument,
            tagsState,
        ],
    );

    const handleDocumentTagDetach = useCallback(
        async (documentId?: DocumentId, tagId?: DocumentId) => {
            if (!documentId || !tagId) {
                return false;
            }

            await deleteDocumentTag(documentId, tagId);
            // Inlined applyTagRemovalToCaches logic
            documentsState.documentsManager.map((doc) => {
                if (doc.id !== documentId) {
                    return undefined;
                }
                if (!doc || !Array.isArray(doc.tags)) {
                    return doc;
                }
                // Filter IDs
                const nextTags = doc.tags.filter((id) => id !== tagId);
                if (nextTags.length === doc.tags.length) {
                    return doc;
                }
                return { ...doc, tags: nextTags };
            });
            return true;
        },
        [documentsState],
    );

    return {
        handleDocumentTagAdd,
        handleDocumentTagAttach,
        handleDocumentTagDetach,
    };
};
