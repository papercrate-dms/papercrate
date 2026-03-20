import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { Identifier } from '../../types/identifiers';
import type { UsePasskeysResult } from '../../settings/usePasskeys';
import { useAppState } from '../store/appState';
import useAuthManager from '../../documents/data/useAuthManager';
import useTenantManager from '../../documents/data/useTenantManager';
import usePasskeys from '../../settings/usePasskeys';

export interface TenantOption {
  id?: Identifier | null;
  name?: string | null;
  slug?: string | null;
  [key: string]: unknown;
}

export interface SessionContextValue {
  token: string | null;
  appStatus: string;
  handleLogout: () => void;
  tenant: TenantOption | null;
  tenants: TenantOption[];
  handleTenantSelect: (tenant: TenantOption | null, options?: { refreshOnly?: boolean }) => void;
  passkeys: UsePasskeysResult;
}

const [SessionContext, useSession] = createSafeContext<SessionContextValue>('Session');

interface SessionProviderProps {
  onDocumentsViewModeChange: (mode: string) => void;
  children: React.ReactNode;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ onDocumentsViewModeChange, children }) => {
  const { status: appStatus, token, tenant, tenants: tenantsRaw = [] } = useAppState();
  const { handleLogout } = useAuthManager({});
  const tenantRecord = (tenant ?? null) as TenantOption | null;
  const currentTenantId = (tenantRecord?.id ?? null) as Identifier | null;
  const tenantOptions = Array.isArray(tenantsRaw) ? (tenantsRaw as TenantOption[]) : [];
  const { handleTenantSelect } = useTenantManager({ currentTenantId, handleDocumentsViewModeChange: onDocumentsViewModeChange });
  const passkeys = usePasskeys({});

  const value: SessionContextValue = {
    token: token ?? null,
    appStatus,
    handleLogout,
    tenant: tenantRecord,
    tenants: tenantOptions,
    handleTenantSelect,
    passkeys,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export { useSession };
