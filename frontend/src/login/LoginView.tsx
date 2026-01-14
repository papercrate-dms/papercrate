import React, { useState } from 'react';
import { TenantOption, TenantSelectionState, LoginActionState } from './types';
import { TenantSelector } from './TenantSelector';
import { MagicForm } from './MagicForm';
import { PasskeyForm } from './PasskeyForm';

const loginLogoSrc = new URL('../assets/logo.webp', import.meta.url).toString();

interface StatusBannerProps {
  status?: { message: string; variant: string } | null;
}

const StatusBanner: React.FC<StatusBannerProps> = ({ status }) => {
  if (!status) return null;
  return <div className={`status-banner ${status.variant}`}>{status.message}</div>;
};

interface LoginViewProps {
  status?: { message: string; variant: string } | null;

  // Tenant Selection
  tenantSelection?: TenantSelectionState | null;
  onSelectTenant?: (tenant: TenantOption) => void;
  onCancelSelection?: () => void;
  selectingTenantId?: string | null;

  // Login Handlers
  onPasskeyLogin?: (username: string) => void;
  onSignup?: (username: string) => void;
  onMagicLogin?: (token: string) => void;

  // Capabilities & State
  passkeySupported?: boolean;
  signupSupported?: boolean;
  initialUsername?: string;

  // Single Loading State Enum
  activeAction: LoginActionState;
}

const LoginView: React.FC<LoginViewProps> = ({
  status,
  tenantSelection,
  onSelectTenant,
  onCancelSelection,
  selectingTenantId,
  onPasskeyLogin,
  onSignup,
  passkeySupported = false,
  signupSupported = false,
  initialUsername = '',
  onMagicLogin,
  activeAction,
}) => {
  const hasTenantSelection = Boolean(tenantSelection?.tenants?.length);
  const [isMagicMode, setIsMagicMode] = useState(false);

  // Derived loading states
  const isLoading = activeAction !== 'idle';
  const passkeyLoading = activeAction === 'passkey';
  const signupLoading = activeAction === 'signup';

  const renderContent = () => {
    if (hasTenantSelection && tenantSelection) {
      return (
        <TenantSelector
          tenantSelection={tenantSelection}
          onSelectTenant={onSelectTenant}
          onCancelSelection={onCancelSelection}
          selectingTenantId={selectingTenantId}
        />
      );
    }

    if (isMagicMode) {
      return (
        <MagicForm
          isLoading={isLoading}
          onMagicLogin={onMagicLogin}
          onBack={() => setIsMagicMode(false)}
        />
      );
    }

    return (
      <PasskeyForm
        initialUsername={initialUsername}
        onPasskeyLogin={onPasskeyLogin}
        onSignup={onSignup}
        passkeySupported={passkeySupported}
        signupSupported={signupSupported}
        passkeyLoading={passkeyLoading}
        signupLoading={signupLoading}
        isLoading={isLoading}
        onSwitchToMagic={() => setIsMagicMode(true)}
      />
    );
  };

  return (
    <div className="login-screen">
      <div className="login-screen__inner">
        <div className="login-screen__content">
          <div className="login-screen__brand">
            <img
              src={loginLogoSrc}
              alt="Papercrate logo"
              width={72}
              height={72}
              decoding="async"
              loading="lazy"
            />
            <h1>Papercrate</h1>
          </div>

          <div className="login-card">
            {renderContent()}
            <StatusBanner status={status} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
