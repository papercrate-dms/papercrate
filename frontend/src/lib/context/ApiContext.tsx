import React, { useEffect, useMemo } from 'react';
import type { PropsWithChildren } from 'react';
import { httpClient, setAuthToken, clearAuthToken } from '../api/apiClient';
import { createSafeContext } from '../../utils/createSafeContext';

type HttpClient = typeof httpClient;

interface ApiContextValue {
  client: HttpClient;
  setAuthToken: (token: string) => void;
  clearAuthToken: () => void;
}

const [ApiContext, useApi] = createSafeContext<ApiContextValue>('Api');

export const ApiProvider: React.FC<PropsWithChildren<{ initialToken?: string | null }>> = ({
  initialToken = null,
  children,
}) => {
  useEffect(() => {
    if (initialToken) {
      setAuthToken(initialToken);
    }
  }, [initialToken]);

  const value = useMemo<ApiContextValue>(
    () => ({
      client: httpClient,
      setAuthToken,
      clearAuthToken,
    }),
    [],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
};

export { useApi };
