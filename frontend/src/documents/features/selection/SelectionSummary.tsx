import React from 'react';
import { FileIcon, FolderOutlineIcon } from '../../../components/icons';

interface SelectionSummaryProps {
  documentCount?: number;
  folderCount?: number;
  totalCount?: number;
}

const SelectionSummary: React.FC<SelectionSummaryProps> = ({ documentCount = 0, folderCount = 0, totalCount = 0 }) => {
  const docCount = Number(documentCount) || 0;
  const folderCountNumber = Number(folderCount) || 0;
  const aggregateCount = docCount + folderCountNumber;
  const resolvedTotal = Number(totalCount) || aggregateCount;

  if (!docCount && !folderCountNumber && !resolvedTotal) {
    return null;
  }

  const tokens = [];

  if (docCount) {
    tokens.push({
      key: 'documents',
      count: docCount,
      icon: <FileIcon className="icon-inline" />,
    });
  }

  if (folderCountNumber) {
    tokens.push({
      key: 'folders',
      count: folderCountNumber,
      icon: <FolderOutlineIcon className="icon-inline" />,
    });
  }

  if (!tokens.length) {
    const count = resolvedTotal;
    return (
      <span className="quick-add__chip-label">
        {`${count} item${count === 1 ? '' : 's'}`}
      </span>
    );
  }

  return (
    <span className="selection-summary">
      {tokens.map((token) => (
        <span key={token.key} className="selection-summary__token">
          {token.icon}
          <span>{token.count}</span>
        </span>
      ))}
    </span>
  );
};

export default SelectionSummary;
