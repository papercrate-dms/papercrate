import React, { useEffect, useCallback } from 'react';
import SettingsModal from '../settings/SettingsModal';
import { useSession } from '../lib/context/SessionContext';
import { useUI } from '../lib/context/UIContext';
import useApiTokens from '../settings/useApiTokens';
import useCapabilitySets from '../settings/useCapabilitySets';
import useCapabilities from '../settings/useCapabilities';

interface SettingsRouteProps {
  open?: boolean;
  onClose?: () => void;
}

const SettingsRoute: React.FC<SettingsRouteProps> = ({ open = true, onClose }) => {
  const { token, passkeys: passkeysState } = useSession();
  const { notifyApiError } = useUI();
  const {
    passkeys,
    passkeysSupported,
    passkeysLoading,
    registeringPasskey,
    revokingPasskeyId,
    refreshPasskeys,
    registerPasskey,
    revokePasskey,
  } = passkeysState;

  const {
    tokens,
    loading: tokensLoading,
    creating: creatingToken,
    deletingId,
    regeneratingId,
    createdSecret,
    refresh: refreshTokens,
    create: createToken,
    revoke: revokeToken,
    regenerate: regenerateToken,
    dismissSecret,
  } = useApiTokens({ token, notifyApiError });

  const {
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
  } = useCapabilitySets({ token, notifyApiError });

  const {
    capabilities,
    capabilitiesLoading,
    refreshCapabilities,
  } = useCapabilities({ notifyApiError, token });

  useEffect(() => {
    refreshTokens();
    refreshCapabilitySets();
    refreshCapabilities();
    refreshPasskeys();
  }, [refreshTokens, refreshCapabilitySets, refreshCapabilities, refreshPasskeys]);

  const handleRefresh = useCallback(() => {
    refreshTokens();
    refreshCapabilitySets();
    refreshCapabilities();
  }, [refreshTokens, refreshCapabilitySets, refreshCapabilities]);

  const handleClose = useCallback(() => {
    dismissSecret();
    onClose?.();
  }, [dismissSecret, onClose]);

  useEffect(() => () => {
    dismissSecret();
  }, [dismissSecret]);

  if (!open) {
    return null;
  }

  return (
    <SettingsModal
      open={open}
      onClose={handleClose}
      tokens={tokens}
      loading={tokensLoading}
      creating={creatingToken}
      deletingId={deletingId}
      regeneratingId={regeneratingId}
      onRefresh={handleRefresh}
      onCreate={createToken}
      onDelete={revokeToken}
      onRegenerate={regenerateToken}
      createdToken={createdSecret}
      onDismissCreatedToken={dismissSecret}
      capabilitySets={capabilitySets}
      capabilitySetsLoading={capabilitySetsLoading}
      creatingCapabilitySet={creatingCapabilitySet}
      savingCapabilitySetId={savingCapabilitySetId}
      deletingCapabilitySetId={deletingCapabilitySetId}
      supportsCapabilitySetLabels={supportsCapabilitySetLabels}
      onRefreshCapabilitySets={refreshCapabilitySets}
      capabilities={capabilities}
      capabilitiesLoading={capabilitiesLoading}
      onRefreshCapabilities={refreshCapabilities}
      onCreateCapabilitySet={createCapabilitySet}
      onUpdateCapabilitySet={updateCapabilitySet}
      onDeleteCapabilitySet={deleteCapabilitySet}
      passkeys={passkeys}
      passkeysSupported={passkeysSupported}
      passkeysLoading={passkeysLoading}
      registeringPasskey={registeringPasskey}
      revokingPasskeyId={revokingPasskeyId}
      onRefreshPasskeys={refreshPasskeys}
      onRegisterPasskey={registerPasskey}
      onRevokePasskey={revokePasskey}
    />
  );
};

export default SettingsRoute;
