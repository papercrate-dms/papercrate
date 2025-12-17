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
  floatingActions?: ReactNode;
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
    <h2>
      <BreadcrumbTrail entries={trailEntries} separator="/" />
      {header.subtitle ? (
        <span className="panel-header__subtitle">{header.subtitle}</span>
      ) : null}
    </h2>
  );

  return (
    <>
      <PanelHeader
        leading={header.leading}
        title={headerTitle}
        titleTag="h2"
        actions={header.actions}
      />
      {header.floatingActions}
    </>
  );
};

export default DocumentsPanelHeader;
