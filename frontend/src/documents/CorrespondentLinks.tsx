import React from 'react';
import { NBSP } from '../constants/ui';

interface CorrespondentLinkEntry {
  id?: string | null;
  name?: string | null;
  key?: string;
}

interface CorrespondentLinksProps {
  correspondents?: CorrespondentLinkEntry[];
  activeCorrespondentIdSet?: Set<string>;
  onCorrespondentClick?: (id: string) => void;
}

const CorrespondentLinks: React.FC<CorrespondentLinksProps> = ({
  correspondents,
  activeCorrespondentIdSet,
  onCorrespondentClick,
}) => {
  if (!Array.isArray(correspondents) || correspondents.length === 0) {
    return null;
  }

  const activeSet = activeCorrespondentIdSet || new Set<string>();
  const handleClick = (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>, correspondent: CorrespondentLinkEntry) => {
    if (!onCorrespondentClick || correspondent.id == null) {
      return;
    }
    event.stopPropagation();
    onCorrespondentClick(correspondent.id);
  };

  return correspondents.map((correspondent, index) => {
    const isActive = correspondent.id != null && activeSet.has(correspondent.id);
    const hasHandler = Boolean(onCorrespondentClick) && correspondent.id != null;
    const classNames = ['doc-correspondent-link'];
    if (isActive) classNames.push('is-active');
    if (!hasHandler) classNames.push('is-static');
    const isLast = index === correspondents.length - 1;
    const fallbackLabel = correspondent.name ?? '—';
    const label = isLast ? `${fallbackLabel}:${NBSP}` : fallbackLabel;

    return (
      <React.Fragment
        key={correspondent.key ?? correspondent.id ?? `${fallbackLabel}-${index}`}
      >
        <button
          type="button"
          className={classNames.join(' ')}
          aria-disabled={hasHandler ? undefined : true}
          onClick={(event) => handleClick(event, correspondent)}
          onKeyDown={(event) => {
            if (!hasHandler) {
              return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              handleClick(event, correspondent);
            }
          }}
        >
          {label}
        </button>
        {isLast ? null : <span className="doc-correspondent-link__separator">, </span>}
      </React.Fragment>
    );
  });
};

export default CorrespondentLinks;
