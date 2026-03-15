import React from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import type { Identifier } from '../../types/identifiers';
import type { UsePasskeysResult } from '../../settings/usePasskeys';

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
  tenantOptions: TenantOption[];
  handleTenantSelect: (tenant: TenantOption | null, options?: { refreshOnly?: boolean }) => void;
  passkeys: UsePasskeysResult;
}

const [SessionContext, useSession] = createSafeContext<SessionContextValue>('Session');

export const SessionProvider: React.FC<{ value: SessionContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
);

export { useSession };
