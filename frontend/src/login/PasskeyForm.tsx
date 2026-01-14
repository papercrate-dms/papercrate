import React, { useEffect, useState } from 'react';

interface PasskeyFormProps {
    initialUsername?: string;
    onPasskeyLogin?: (username: string) => void;
    onSignup?: (username: string) => void;
    passkeySupported?: boolean;
    passkeyLoading?: boolean;
    signupSupported?: boolean;
    signupLoading?: boolean;
    onSwitchToMagic?: () => void;
    isLoading: boolean;
}

export const PasskeyForm: React.FC<PasskeyFormProps> = ({
    initialUsername = '',
    onPasskeyLogin,
    onSignup,
    passkeySupported = false,
    passkeyLoading = false,
    signupSupported = false,
    signupLoading = false,
    onSwitchToMagic,
    isLoading,
}) => {
    const [username, setUsername] = useState(initialUsername);

    useEffect(() => {
        setUsername(initialUsername);
    }, [initialUsername]);

    const handlePasskeyClick = () => {
        onPasskeyLogin?.(username.trim());
    };

    const handleSignupClick = () => {
        onSignup?.(username.trim());
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!passkeySupported || isLoading || !username.trim()) {
            return;
        }
        handlePasskeyClick();
    };

    const busy = isLoading || passkeyLoading || signupLoading;

    return (
        <>
            <p>Use your registered passkey to sign in or create a new account.</p>
            <form className="login-card__fields" onSubmit={handleSubmit}>
                <label htmlFor="username">Username</label>
                <input
                    type="text"
                    id="username"
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Username"
                    autoComplete="username"
                    disabled={busy}
                    required
                />
                {passkeySupported ? (
                    <button
                        type="submit"
                        className="login-card__passkey-button"
                        disabled={busy || !username.trim()}
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
                    disabled={busy || !username.trim()}
                >
                    {signupLoading ? 'Creating account…' : 'Create account with passkey'}
                </button>
            ) : null}

            <div className="login-card__separator">
                <span>or</span>
            </div>

            <button
                type="button"
                className="text-button"
                style={{ width: '100%' }}
                onClick={onSwitchToMagic}
                disabled={busy}
            >
                Use Magic Token
            </button>
        </>
    );
};
