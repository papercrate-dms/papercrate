import { useCallback, useEffect, useState } from 'react';
import {
  createCapabilitySet as createCapabilitySetRequest,
  deleteCapabilitySet as deleteCapabilitySetRequest,
  listCapabilitySets,
  updateCapabilitySet as updateCapabilitySetRequest,
} from '../lib/api/apiClient';
import type { Identifier } from '../types/identifiers';

interface CapabilitySet {
  id?: Identifier;
  slug: string;
  label?: string;
  capabilities: string[];
  [key: string]: unknown;
}

interface UseCapabilitySetsOptions {
  notifyApiError?: (error: unknown, message: string) => void;
  setStatusMessage?: (message: string, level?: string) => void;
  token?: string | null;
}

const useCapabilitySets = ({ notifyApiError, setStatusMessage, token }: UseCapabilitySetsOptions) => {
  const [capabilitySets, setCapabilitySets] = useState<CapabilitySet[]>([]);
  const [capabilitySetsLoading, setCapabilitySetsLoading] = useState(false);
  const [creatingCapabilitySet, setCreatingCapabilitySet] = useState(false);
  const [savingCapabilitySetId, setSavingCapabilitySetId] = useState<Identifier | null>(null);
  const [deletingCapabilitySetId, setDeletingCapabilitySetId] = useState<Identifier | null>(null);
  const [supportsCapabilitySetLabels, setSupportsCapabilitySetLabels] = useState(false);

  const applyCapabilitySets = useCallback((updater: CapabilitySet[] | ((prev: CapabilitySet[]) => CapabilitySet[])) => {
    setCapabilitySets((previous) => {
      const base = Array.isArray(previous) ? [...previous] : [];
      const next = Array.isArray(updater)
        ? [...updater]
        : updater(base);
      const supportsLabels = next.some((item) => Object.prototype.hasOwnProperty.call(item || {}, 'label'));
      setSupportsCapabilitySetLabels(supportsLabels);
      return next;
    });
  }, []);

  const refreshCapabilitySets = useCallback(async () => {
    if (!token) {
      applyCapabilitySets([]);
      return;
    }
    setCapabilitySetsLoading(true);
    try {
      const data = await listCapabilitySets();
      applyCapabilitySets(Array.isArray(data) ? data : []);
    } catch (error) {
      notifyApiError?.(error, 'Failed to load capability sets.');
    } finally {
      setCapabilitySetsLoading(false);
    }
  }, [applyCapabilitySets, notifyApiError, token]);

  useEffect(() => {
    if (token) {
      refreshCapabilitySets();
    } else {
      applyCapabilitySets([]);
    }
  }, [applyCapabilitySets, refreshCapabilitySets, token]);

  const createCapabilitySet = useCallback(
    async ({ slug, label, capabilities }: { slug?: string; label?: string; capabilities?: string[] } = {}) => {
      if (creatingCapabilitySet) {
        return false;
      }
      if (!Array.isArray(capabilities) || capabilities.length === 0) {
        setStatusMessage?.('Select at least one capability.', 'error');
        return false;
      }
      setCreatingCapabilitySet(true);
      try {
        const payload: { slug?: string; label?: string; capabilities: string[] } = {
          capabilities,
        };
        const trimmedSlug = slug?.trim();
        if (trimmedSlug) {
          payload.slug = trimmedSlug;
        }
        const trimmedLabel = label?.trim();
        if (trimmedLabel && supportsCapabilitySetLabels) {
          payload.label = trimmedLabel;
        }

        const data = await createCapabilitySetRequest(payload);
        if (data) {
          applyCapabilitySets((previous) => {
            const next = previous.filter((entry) => entry?.id !== data.id);
            next.push(data);
            next.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
            return next;
          });
        } else {
          await refreshCapabilitySets();
        }
        setStatusMessage?.('Capability set created.', 'success');
        return data;
      } catch (error) {
        notifyApiError?.(error, 'Failed to create capability set.');
        return false;
      } finally {
        setCreatingCapabilitySet(false);
      }
    },
    [
      applyCapabilitySets,
      creatingCapabilitySet,
      notifyApiError,
      refreshCapabilitySets,
      setStatusMessage,
      supportsCapabilitySetLabels,
    ],
  );

  const updateCapabilitySet = useCallback(
    async (
      capabilitySetId: Identifier | null,
      { slug, label, capabilities }: { slug?: string; label?: string; capabilities?: string[] } = {},
    ) => {
      if (!capabilitySetId) {
        return false;
      }
      setSavingCapabilitySetId(capabilitySetId);
      try {
        const payload: { slug?: string; label?: string; capabilities?: string[] } = {};
        if (slug !== undefined) {
          const trimmed = slug?.trim();
          if (trimmed) {
            payload.slug = trimmed;
          } else if (slug === '') {
            payload.slug = '';
          }
        }
        if (label !== undefined && supportsCapabilitySetLabels) {
          const trimmed = label?.trim();
          if (trimmed) {
            payload.label = trimmed;
          } else if (label === '') {
            payload.label = '';
          }
        }
        if (Array.isArray(capabilities)) {
          payload.capabilities = capabilities;
        }

        const data = await updateCapabilitySetRequest(capabilitySetId, payload);
        if (data) {
          applyCapabilitySets((previous) => {
            let found = false;
            const next = previous.map((entry) => {
              if (entry?.id === data.id) {
                found = true;
                return data;
              }
              return entry;
            });
            if (!found) {
              next.push(data);
            }
            next.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
            return next;
          });
        } else {
          await refreshCapabilitySets();
        }
        setStatusMessage?.('Capability set updated.', 'success');
        return true;
      } catch (error) {
        notifyApiError?.(error, 'Failed to update capability set.');
        return false;
      } finally {
        setSavingCapabilitySetId(null);
      }
    },
    [
      applyCapabilitySets,
      notifyApiError,
      refreshCapabilitySets,
      setStatusMessage,
      supportsCapabilitySetLabels,
    ],
  );

  const deleteCapabilitySet = useCallback(
    async (capabilitySetId: Identifier | null) => {
      if (!capabilitySetId) {
        return false;
      }
      setDeletingCapabilitySetId(capabilitySetId);
      try {
        await deleteCapabilitySetRequest(capabilitySetId);
        applyCapabilitySets((previous) => previous.filter((entry) => entry?.id !== capabilitySetId));
        setStatusMessage?.('Capability set deleted.', 'success');
        return true;
      } catch (error) {
        notifyApiError?.(error, 'Failed to delete capability set.');
        return false;
      } finally {
        setDeletingCapabilitySetId(null);
      }
    },
    [applyCapabilitySets, notifyApiError, setStatusMessage],
  );

  return {
    capabilitySets,
    capabilitySetsLoading,
    creatingCapabilitySet,
    savingCapabilitySetId,
    deletingCapabilitySetId,
    supportsCapabilitySetLabels,
    refreshCapabilitySets,
    createCapabilitySet,
    updateCapabilitySet,
    deleteCapabilitySet,
  };
};

export default useCapabilitySets;
