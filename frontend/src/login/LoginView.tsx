import React, { useEffect, useState } from 'react';

const loginLogoSrc = new URL('../assets/logo.webp', import.meta.url).toString();

interface StatusBannerProps {
  status?: { message: string; variant: string } | null;
}

const StatusBanner: React.FC<StatusBannerProps> = ({ status }) => {
  if (!status) return null;
  return <div className={`status-banner ${status.variant}`}>{status.message}</div>;
};

interface TenantOption {
  id?: string;
  name?: string;
}

interface TenantSelectionState {
  tenants?: TenantOption[];
}

interface LoginViewProps {
  status?: { message: string; variant: string } | null;
  tenantSelection?: TenantSelectionState | null;
  onSelectTenant?: (tenant: TenantOption) => void;
  onCancelSelection?: () => void;
  selectingTenantId?: string | null;
  onPasskeyLogin?: (username: string) => void;
  onSignup?: (username: string) => void;
  passkeySupported?: boolean;
  passkeyLoading?: boolean;
  signupSupported?: boolean;
  signupLoading?: boolean;
  magicLoginPending?: boolean;
  initialUsername?: string;
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
  passkeyLoading = false,
  signupSupported = false,
  signupLoading = false,
  magicLoginPending = false,
  initialUsername = '',
}) => {
  const hasTenantSelection = Boolean(tenantSelection?.tenants?.length);
  const [username, setUsername] = useState(initialUsername);

  useEffect(() => {
    setUsername(initialUsername);
  }, [initialUsername]);

  const handlePasskeyClick = () => {
    if (!onPasskeyLogin) {
      return;
    }
    onPasskeyLogin(username);
  };

  const handleSignupClick = () => {
    if (!onSignup) {
      return;
    }
    onSignup(username);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passkeySupported || passkeyLoading || magicLoginPending || !username.trim()) {
      return;
    }
    handlePasskeyClick();
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
            {hasTenantSelection ? (
              <div className="login-card__selection">
                <p>Select a tenant to finish signing in.</p>
                <div className="login-card__tenant-list">
                  {tenantSelection?.tenants?.map((tenant) => (
                    <button
                      key={tenant.id}
                      type="button"
                      onClick={() => onSelectTenant?.(tenant)}
                      disabled={Boolean(selectingTenantId)}
                      className={
                        selectingTenantId === tenant.id
                          ? 'login-card__tenant-button is-loading'
                          : 'login-card__tenant-button'
                      }
                    >
                      {tenant.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="login-card__back-button"
                  onClick={() => onCancelSelection?.()}
                  disabled={Boolean(selectingTenantId)}
                >
                  Use a different account
                </button>
              </div>
            ) : (
              <>
                <p>Use your registered passkey to sign in or create a new account.</p>
                <form className="login-card__fields" onSubmit={handleSubmit}>
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Username"
                    autoComplete="username"
                    disabled={passkeyLoading || magicLoginPending}
                    required
                  />
                  {passkeySupported ? (
                    <button
                      type="submit"
                      className="login-card__passkey-button"
                      disabled={passkeyLoading || magicLoginPending || !username.trim()}
                    >
                      {passkeyLoading ? 'Signing in…' : 'Sign in with passkey'}
                    </button>
                  ) : (
                    <p className="settings-empty">Passkeys are not supported in this browser.</p>
                  )}
                </form>
                {signupSupported ? (
                  <button
                    type="button"
                    className="login-card__signup-button"
                    onClick={handleSignupClick}
                    disabled={signupLoading || magicLoginPending || !username.trim()}
                  >
                    {signupLoading ? 'Creating account…' : 'Create account with passkey'}
                  </button>
                ) : null}
              </>
            )}
            <StatusBanner status={status} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
