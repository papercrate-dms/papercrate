import React from 'react';
import { useDocumentsSearch } from '../../lib/context/DocumentsSearchContext';
import { ChevronUpIcon, ChevronDownIcon } from '../../components/icons';

interface DocumentsListContainerProps {
    children: React.ReactNode;
    clearSelection: () => void;
    iconSize?: number;
    [key: string]: any;
}

const COLUMNS: Array<{ label: string; field: string | null }> = [
    { label: '', field: null },
    { label: 'Title', field: 'title' },
    { label: 'Issued', field: 'issued_at' },
    { label: 'Added', field: 'created_at' },
];

const DocumentsListContainer: React.FC<DocumentsListContainerProps> = ({
    children,
    clearSelection,
    iconSize: _iconSize,
    ...props
}) => {
    const {
        documentsSortField,
        documentsSortDirection,
        handleDocumentsSortFieldChange,
        handleDocumentsSortDirectionToggle,
    } = useDocumentsSearch();

    const handleColumnClick = (field: string | null, event: React.MouseEvent) => {
        event.stopPropagation();
        if (!field) return;
        if (documentsSortField === field) {
            handleDocumentsSortDirectionToggle();
        } else {
            handleDocumentsSortFieldChange(field);
        }
    };

    return (
        <table aria-multiselectable="true" {...props}>
            <thead
                onClick={() => {
                    clearSelection();
                }}
            >
                <tr>
                    {COLUMNS.map(({ label, field }) => (
                        <th
                            key={field ?? 'icon'}
                            className={field ? 'sortable' : undefined}
                            onClick={field ? (e) => handleColumnClick(field, e) : undefined}
                            aria-sort={
                                field && documentsSortField === field
                                    ? documentsSortDirection === 'asc' ? 'ascending' : 'descending'
                                    : undefined
                            }
                        >
                            {label}
                            {field && documentsSortField === field && (
                                <span className="sort-indicator" aria-hidden="true">
                                    {documentsSortDirection === 'asc'
                                        ? <ChevronUpIcon size={14} />
                                        : <ChevronDownIcon size={14} />}
                                </span>
                            )}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    );
};

export default DocumentsListContainer;
