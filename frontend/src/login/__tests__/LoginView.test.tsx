import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import LoginView from '../LoginView';
import { TenantOption } from '../types';

describe('LoginView Component', () => {
    const defaultProps = {
        activeAction: 'idle' as const,
        passkeySupported: true,
        passkeyLoading: false,
        signupSupported: true,
        initialUsername: '',
    };

    it('renders passkey form by default', () => {
        render(<LoginView {...defaultProps} />);
        expect(screen.getByRole('textbox', { name: /username/i })).toBeInTheDocument();
        expect(screen.getByText('Sign in with passkey')).toBeInTheDocument();
        expect(screen.getByText('Use Magic Token')).toBeInTheDocument();
    });

    it('switches to magic token form when clicked', async () => {
        const user = userEvent.setup();
        render(<LoginView {...defaultProps} />);

        // Click "Use Magic Token"
        await user.click(screen.getByText('Use Magic Token'));

        // Check for Magic Token UI
        expect(screen.getByRole('textbox', { name: /magic token/i })).toBeInTheDocument();
        expect(screen.getByText('Enter your magic token to sign in.')).toBeInTheDocument();
        expect(screen.getByText('Back to username')).toBeInTheDocument();
    });

    it('calls onPasskeyLogin when username form is submitted', async () => {
        const user = userEvent.setup();
        const onPasskeyLogin = vi.fn();
        render(<LoginView {...defaultProps} onPasskeyLogin={onPasskeyLogin} initialUsername="testuser" />);

        // user.type is more realistic but we already have the value, 
        // to submit we can just click the button or hit enter.
        // Let's type a new value to be sure.
        const input = screen.getByRole('textbox', { name: /username/i });
        await user.clear(input);
        await user.type(input, 'new-user');
        await user.click(screen.getByText('Sign in with passkey'));

        expect(onPasskeyLogin).toHaveBeenCalledWith('new-user');
    });

    it('calls onMagicLogin when magic form is submitted', async () => {
        const user = userEvent.setup();
        const onMagicLogin = vi.fn();
        render(<LoginView {...defaultProps} onMagicLogin={onMagicLogin} />);

        // Switch to magic
        await user.click(screen.getByText('Use Magic Token'));

        const input = screen.getByRole('textbox', { name: /magic token/i });
        await user.type(input, 'magic-123');
        await user.click(screen.getByText('Sign in'));

        expect(onMagicLogin).toHaveBeenCalledWith('magic-123');
    });

    it('shows tenant selector when tenantSelection is provided', () => {
        const tenants: TenantOption[] = [
            { id: 't1', name: 'Tenant One' },
            { id: 't2', name: 'Tenant Two' },
        ];

        render(
            <LoginView
                {...defaultProps}
                tenantSelection={{ tenants }}
            />
        );

        expect(screen.getByText('Select a tenant to finish signing in.')).toBeInTheDocument();
        expect(screen.getByText('Tenant One')).toBeInTheDocument();
        expect(screen.getByText('Tenant Two')).toBeInTheDocument();
    });

    it('disables buttons when loading', () => {
        render(
            <LoginView
                {...defaultProps}
                activeAction="passkey" // loading state
            />
        );

        expect(screen.getByRole('textbox', { name: /username/i })).toBeDisabled();
    });

    it('calls onSignup when signup button is clicked', async () => {
        const user = userEvent.setup();
        const onSignup = vi.fn();
        render(
            <LoginView
                {...defaultProps}
                onSignup={onSignup}
                initialUsername="newuser"
            />
        );

        await user.click(screen.getByText('Create account with passkey'));
        expect(onSignup).toHaveBeenCalledWith('newuser');
    });

    it('returns to passkey form from magic form when Back is clicked', async () => {
        const user = userEvent.setup();
        render(<LoginView {...defaultProps} />);

        // Go to Magic
        await user.click(screen.getByText('Use Magic Token'));
        expect(screen.getByRole('textbox', { name: /magic token/i })).toBeInTheDocument();

        // Go Back
        await user.click(screen.getByText('Back to username'));

        // Check we are back
        expect(screen.getByRole('textbox', { name: /username/i })).toBeInTheDocument();
    });

    it('calls onCancelSelection when selecting a tenant', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(
            <LoginView
                {...defaultProps}
                tenantSelection={{ tenants: [{ id: '1', name: 'T1' }] }}
                onCancelSelection={onCancel}
            />
        );

        await user.click(screen.getByText('Use a different account'));
        expect(onCancel).toHaveBeenCalled();
    });

    it('displays error message when status is provided', () => {
        const status = { message: 'Invalid credentials', variant: 'error' as const };
        render(<LoginView {...defaultProps} status={status} />);

        const banner = screen.getByText('Invalid credentials');
        expect(banner).toBeInTheDocument();
        // Removed implementation detail check for specific CSS classes
    });

    it('does not call callbacks when inputs are empty', async () => {
        const user = userEvent.setup();
        const onPasskeyLogin = vi.fn();
        const onMagicLogin = vi.fn();
        render(
            <LoginView
                {...defaultProps}
                onPasskeyLogin={onPasskeyLogin}
                onMagicLogin={onMagicLogin}
                initialUsername=""
            />
        );

        // Try submitting username form
        await user.click(screen.getByText('Sign in with passkey'));
        expect(onPasskeyLogin).not.toHaveBeenCalled();

        // Switch to magic and try submitting empty
        await user.click(screen.getByText('Use Magic Token'));
        // Note: Magic form button is disabled if empty, so clicking it does nothing.
        // We can check if it's disabled or try to click it.
        const magicButton = screen.getByRole('button', { name: "Sign in" });
        await user.click(magicButton);
        expect(onMagicLogin).not.toHaveBeenCalled();
    });

    it('shows unsupported message and disables login if passkeys not supported', () => {
        render(
            <LoginView
                {...defaultProps}
                passkeySupported={false}
            />
        );

        expect(screen.getByText('Passkeys are not supported in this browser.')).toBeInTheDocument();
        expect(screen.queryByText('Sign in with passkey')).not.toBeInTheDocument();
    });

    it('trims whitespace from inputs before calling callbacks', async () => {
        const user = userEvent.setup();
        const onPasskeyLogin = vi.fn();
        render(
            <LoginView
                {...defaultProps}
                onPasskeyLogin={onPasskeyLogin}
                initialUsername=""
            />
        );

        const input = screen.getByRole('textbox', { name: /username/i });
        await user.type(input, '  myuser  ');
        await user.click(screen.getByText('Sign in with passkey'));

        expect(onPasskeyLogin).toHaveBeenCalledWith('myuser');
    });

    it('has accessible labels for inputs', async () => {
        const user = userEvent.setup();
        render(<LoginView {...defaultProps} />);

        // Passkey form
        expect(screen.getByRole('textbox', { name: /username/i })).toBeInTheDocument();

        // Magic form
        await user.click(screen.getByText('Use Magic Token'));
        // We added aria-label="Magic Token"
        expect(screen.getByRole('textbox', { name: /magic token/i })).toBeInTheDocument();
    });

});
