import React from 'react';
import { SessionProvider, type SessionContextValue } from './SessionContext';
import { UIProvider, type UIContextValue } from './UIContext';
import { TagsProvider, type TagsContextValue } from './TagsContext';
import { CorrespondentsProvider, type CorrespondentsContextValue } from './CorrespondentsContext';
import { FolderTreeProvider, type FolderTreeContextValue } from './FolderTreeContext';
import { DocumentsSearchProvider, type DocumentsSearchContextValue } from './DocumentsSearchContext';
import { DocumentsWorkspaceProvider, type DocumentsWorkspaceContextValue } from './DocumentsWorkspaceContext';
import { NewDocumentsProvider } from './NewDocumentsContext';

export interface DomainValues {
  session: SessionContextValue;
  ui: UIContextValue;
  tags: TagsContextValue;
  correspondents: CorrespondentsContextValue;
  folderTree: FolderTreeContextValue;
  search: DocumentsSearchContextValue;
  workspace: DocumentsWorkspaceContextValue;
}

interface DomainProviderStackProps {
  domains: DomainValues;
  children: React.ReactNode;
}

const DomainProviderStack: React.FC<DomainProviderStackProps> = ({ domains, children }) => (
  <SessionProvider value={domains.session}>
    <UIProvider value={domains.ui}>
      <TagsProvider value={domains.tags}>
        <CorrespondentsProvider value={domains.correspondents}>
          <FolderTreeProvider value={domains.folderTree}>
            <DocumentsSearchProvider value={domains.search}>
              <DocumentsWorkspaceProvider value={domains.workspace}>
                <NewDocumentsProvider>
                  {children}
                </NewDocumentsProvider>
              </DocumentsWorkspaceProvider>
            </DocumentsSearchProvider>
          </FolderTreeProvider>
        </CorrespondentsProvider>
      </TagsProvider>
    </UIProvider>
  </SessionProvider>
);

export default DomainProviderStack;
