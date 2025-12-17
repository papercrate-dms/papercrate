import React from 'react';

interface DocumentsGridContainerProps {
    children: React.ReactNode;
    clearSelection: () => void;
    iconSize?: number;
    [key: string]: any;
}

const DocumentsGridContainer: React.FC<DocumentsGridContainerProps> = ({
    children,
    clearSelection,
    iconSize,
    ...props
}) => {
    return (
        <div
            className="documents-grid"
            role="list"
            {...props}
            style={
                iconSize
                    ? ({ '--documents-grid-icon-size': `${iconSize}px` } as React.CSSProperties)
                    : undefined
            }
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    clearSelection();
                }
            }}
        >
            {children}
        </div>
    );
};

export default DocumentsGridContainer;
