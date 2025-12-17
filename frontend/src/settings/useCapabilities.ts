import { useCallback, useEffect, useState } from 'react';
import { listCapabilities } from '../lib/api/apiClient';

interface UseCapabilitiesOptions {
  notifyApiError?: (error: unknown, fallbackMessage: string) => void;
  token?: string | null;
}

const useCapabilities = ({ notifyApiError, token }: UseCapabilitiesOptions) => {
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);

  const refreshCapabilities = useCallback(async () => {
    if (!token) {
      setCapabilities([]);
      return;
    }
    setCapabilitiesLoading(true);
    try {
      const data = await listCapabilities();
      setCapabilities(Array.isArray(data) ? data.map((item) => item.name) : []);
    } catch (error) {
      notifyApiError?.(error, 'Failed to load capabilities.');
      setCapabilities([]);
    } finally {
      setCapabilitiesLoading(false);
    }
  }, [notifyApiError, token]);

  useEffect(() => {
    if (token) {
      refreshCapabilities();
    } else {
      setCapabilities([]);
    }
  }, [refreshCapabilities, token]);

  return {
    capabilities,
    capabilitiesLoading,
    refreshCapabilities,
  };
};

export default useCapabilities;
