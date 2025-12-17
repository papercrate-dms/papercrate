import React from 'react';
import type { useWorkspaceSelection } from './useWorkspaceSelection';
import { createSafeContext } from '../utils/createSafeContext';

type WorkspaceSelectionValue = ReturnType<typeof useWorkspaceSelection>;

const [WorkspaceSelectionContext, useWorkspaceSelectionContext] = createSafeContext<WorkspaceSelectionValue>('WorkspaceSelection');

interface WorkspaceSelectionProviderProps {
  value: WorkspaceSelectionValue;
  children: React.ReactNode;
}

export const WorkspaceSelectionProvider: React.FC<WorkspaceSelectionProviderProps> = ({ value, children }) => (
  <WorkspaceSelectionContext.Provider value={value}>
    {children}
  </WorkspaceSelectionContext.Provider>
);

export { useWorkspaceSelectionContext };
