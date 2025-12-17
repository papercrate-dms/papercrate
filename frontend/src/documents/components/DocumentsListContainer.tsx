import React from 'react';

interface DocumentsListContainerProps {
    children: React.ReactNode;
    clearSelection: () => void;
    iconSize?: number;
    [key: string]: any;
}

const DocumentsListContainer: React.FC<DocumentsListContainerProps> = ({
    children,
    clearSelection,
    iconSize: _iconSize,
    ...props
}) => {
    return (
        <table aria-multiselectable="true" {...props}>
            <thead
                onClick={() => {
                    clearSelection();
                }}
            >
                <tr>
                    <th>&nbsp;</th>
                    <th>Name</th>
                    <th>Issued</th>
                    <th>Added</th>
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    );
};

export default DocumentsListContainer;
