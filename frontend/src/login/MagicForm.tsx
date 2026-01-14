import React, { useState } from 'react';

interface MagicFormProps {
    isLoading: boolean;
    onMagicLogin?: (token: string) => void;
    onBack: () => void;
}

export const MagicForm: React.FC<MagicFormProps> = ({
    isLoading,
    onMagicLogin,
    onBack,
}) => {
    const [magicToken, setMagicToken] = useState('');

    const handleMagicTokenSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isLoading || !magicToken.trim()) {
            return;
        }
        onMagicLogin?.(magicToken.trim());
    };

    return (
        <>
            <p>Enter your magic token to sign in.</p>
            <form className="login-card__fields" onSubmit={handleMagicTokenSubmit}>
                <input
                    type="text"
                    id="magicToken"
                    name="magicToken"
                    aria-label="Magic Token"
                    value={magicToken}
                    onChange={(event) => setMagicToken(event.target.value)}
                    placeholder="Paste token here..."
                    autoComplete="off"
                    disabled={isLoading}
                    required
                />
                <button
                    type="submit"
                    className="login-card__passkey-button"
                    disabled={isLoading || !magicToken.trim()}
                >
                    {isLoading ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
            <button
                type="button"
                className="text-button"
                onClick={onBack}
                disabled={isLoading}
            >
                Back to username
            </button>
        </>
    );
};
