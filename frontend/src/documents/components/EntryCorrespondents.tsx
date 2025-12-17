import React from 'react';
import CorrespondentLinks from '../CorrespondentLinks';
import type { Identifier } from '../../types/identifiers';

interface EntryCorrespondentsProps {
    correspondents: any[];
    activeCorrespondentIdSet?: Set<Identifier> | null;
    onCorrespondentClick?: (correspondentId: Identifier) => void;
}

const EntryCorrespondents: React.FC<EntryCorrespondentsProps> = (props) => {
    if (!props.correspondents || props.correspondents.length === 0) {
        return null;
    }

    return (
        <span className="doc-correspondents">
            <CorrespondentLinks
                correspondents={props.correspondents}
                activeCorrespondentIdSet={props.activeCorrespondentIdSet}
                onCorrespondentClick={props.onCorrespondentClick}
            />
        </span>
    );
};

export default EntryCorrespondents;
