import React, { useEffect, useCallback } from 'react';
import { useDocumentViewLogic, DocumentViewLogic } from './logic/useDocumentViewLogic';
import { useDocumentsNavigation } from './logic/useDocumentsNavigation';
import { useWorkspaceSelectionContext } from '../app/WorkspaceSelectionContext';
import { usePanelManager } from '../app/PanelManagerContext';
import DocumentsListRow from './components/DocumentsListRow';
import DocumentsGridCard from './components/DocumentsGridCard';
import DocumentsListContainer from './components/DocumentsListContainer';
import DocumentsGridContainer from './components/DocumentsGridContainer';
import type { DocumentsViewProps } from './panel/DocumentsPanel';
import { useDocumentsViewStateContext } from './context/DocumentsViewStateContext';
import { useDocumentsCommandContext } from './context/DocumentsCommandContext';

interface AbstractDocumentsViewProps<CProps extends { clearSelection: () => void; children: React.ReactNode }> extends DocumentsViewProps {
    ContainerComponent: React.ComponentType<CProps>;
    ItemComponent: React.ComponentType<{ entry: any; viewLogic: DocumentViewLogic } & DocumentsViewProps>;
    containerProps?: Omit<CProps, 'children' | 'clearSelection'>;
    [key: string]: any;
}

const AbstractDocumentsView = <CProps extends { clearSelection: () => void; children: React.ReactNode }>({
    ContainerComponent,
    ItemComponent,
    containerProps,
    ...props
}: AbstractDocumentsViewProps<CProps>) => {
    const { entries, viewMode } = props;
    const {
        viewId,
        scrollRef
    } = useDocumentsViewStateContext();
    const {
        document: { onRename: onDocumentRename },
        folder: { onRename: onFolderRename, onSelect: onFolderSelect }
    } = useDocumentsCommandContext();

    const viewLogic = useDocumentViewLogic({
        onDocumentRename,
        onFolderRename,
    });
    const { handleKeyDown, handleFocus } = useDocumentsNavigation({
        entries,
        onFolderSelect,
        viewMode: viewMode || props.viewMode,
        scrollRef: scrollRef,
    });
    const { clearSelection } = viewLogic;

    useEffect(() => {
        if (scrollRef?.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [scrollRef, viewId]);

    const { focusedEntryKey } = useWorkspaceSelectionContext();

    const ensureFocusedEntryVisible = useCallback(() => {
        if (!focusedEntryKey) return;
        const container = scrollRef?.current;
        if (!container) return;
        let selector = null;
        if (focusedEntryKey.startsWith('document:')) {
            selector = `#document-${focusedEntryKey.slice('document:'.length)}`;
        } else if (focusedEntryKey.startsWith('folder:')) {
            selector = `#folder-${focusedEntryKey.slice('folder:'.length)}`;
        }
        if (!selector) {
            return;
        }
        const entry = container.querySelector(selector) as HTMLElement;
        if (!entry || !container.contains(entry)) {
            return;
        }

        entry.scrollIntoView({ block: 'nearest' });
    }, [focusedEntryKey, scrollRef]);

    useEffect(() => {
        ensureFocusedEntryVisible();
    }, [ensureFocusedEntryVisible]);

    const { detailPanelOpen } = usePanelManager();

    useEffect(() => {
        const container = scrollRef?.current;
        if (!container) return;

        const handleTransitionEnd = () => {
            ensureFocusedEntryVisible();
        };

        container.addEventListener('transitionend', handleTransitionEnd);

        // Immediate check in case there is no transition or it finished already
        ensureFocusedEntryVisible();

        return () => {
            container.removeEventListener('transitionend', handleTransitionEnd);
        };
    }, [scrollRef, ensureFocusedEntryVisible, detailPanelOpen]);

    return (
        <ContainerComponent
            clearSelection={clearSelection}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            tabIndex={0}
            {...(containerProps as any)}
        >
            {entries.map((entry) => (
                <ItemComponent
                    key={entry.key}
                    entry={entry}
                    viewLogic={viewLogic}
                    {...props}
                />
            ))}
        </ContainerComponent>
    );
};

export const DocumentsList: React.FC<DocumentsViewProps & { iconSize?: number }> = (props) => {
    return (
        <AbstractDocumentsView
            ContainerComponent={DocumentsListContainer}
            ItemComponent={DocumentsListRow}
            viewMode="list"
            containerProps={{ iconSize: props.iconSize }}
            {...props}
        />
    );
};

export const DocumentsGrid: React.FC<DocumentsViewProps & { iconSize?: number }> = (props) => {
    return (
        <AbstractDocumentsView
            ContainerComponent={DocumentsGridContainer}
            ItemComponent={DocumentsGridCard}
            containerProps={{ iconSize: props.iconSize }}
            viewMode="grid"
            {...props}
        />
    );
};
