import React from 'react';
import type { ReactNode } from 'react';
import PanelHeader from '../../components/PanelHeader';
import BreadcrumbTrail from '../../components/BreadcrumbTrail';
import type { Identifier } from '../../types/identifiers';

interface DocumentsHeaderBreadcrumb {
  id?: Identifier;
  name?: string;
  label?: string;
  title?: string;
}

export interface DocumentsPanelHeaderConfig {
  title?: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: DocumentsHeaderBreadcrumb[] | null;
  selectionActions?: ReactNode;
  hasSelection?: boolean;
}

interface DocumentsPanelHeaderProps {
  header?: DocumentsPanelHeaderConfig | null;
  onBreadcrumbClick?: (crumb: DocumentsHeaderBreadcrumb) => void;
}

const DocumentsPanelHeader: React.FC<DocumentsPanelHeaderProps> = ({
  header,
  onBreadcrumbClick,
}) => {
  if (!header) {
    return null;
  }

  const hasSelection = Boolean(header.hasSelection);

  const breadcrumbEntries = Array.isArray(header.breadcrumbs)
    ? header.breadcrumbs.filter(Boolean)
    : [];
  const lastIndex = breadcrumbEntries.length - 1;
  const trailEntries = breadcrumbEntries.length
    ? breadcrumbEntries.map((crumb, index) => ({
      id: crumb.id ?? index,
      label: crumb.name ?? crumb.label ?? crumb.title ?? '',
      onClick: index < lastIndex && onBreadcrumbClick
        ? () => onBreadcrumbClick(crumb)
        : null,
    }))
    : [{ id: 'current-location', label: header.title }];

  const headerTitle = (
    <div>
      <span className="panel-header__breadcrumb">
        <BreadcrumbTrail entries={trailEntries} separator="/" />
        {header.subtitle ? (
          <span className="panel-header__subtitle">{header.subtitle}</span>
        ) : null}
      </span>
      {hasSelection && header.selectionActions ? (
        <>
          <span className="panel-header__selection">
            {header.selectionActions}
          </span>
          <span className="panel-header__breadcrumb" aria-hidden="true" />
        </>
      ) : null}
    </div>
  );

  return (
    <PanelHeader
      className={hasSelection ? 'panel-header--selection' : undefined}
      leading={header.leading}
      title={headerTitle}
      actions={header.actions}
    />
  );
};

export default DocumentsPanelHeader;
