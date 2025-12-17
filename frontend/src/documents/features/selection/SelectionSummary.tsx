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
      icon: <FileIcon className="selection-summary__icon" size={16} />,
    });
  }

  if (folderCountNumber) {
    tokens.push({
      key: 'folders',
      count: folderCountNumber,
      icon: <FolderOutlineIcon className="selection-summary__icon" size={16} />,
    });
  }

  if (!tokens.length) {
    const count = resolvedTotal;
    return (
      <span className="selection-summary selection-summary--text">
        {`${count} item${count === 1 ? '' : 's'}`}
      </span>
    );
  }

  return (
    <span className="selection-summary">
      {tokens.map((token, index) => (
        <React.Fragment key={token.key}>
          {index > 0 ? <span className="selection-summary__separator">·</span> : null}
          <span className="selection-summary__token">
            <span className="selection-summary__count">{token.count}</span>
            {token.icon}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
};

export default SelectionSummary;
