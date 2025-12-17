import { useCallback } from 'react';
import { useStatusToast, ToastVariant } from '../lib/context/StatusToastContext';
import { normalizeMessage } from './useApiError';

const useNotifyApiError = () => {
    const { showToast } = useStatusToast();

    return useCallback(
        (error: unknown, fallbackMessage?: string, variant: ToastVariant = 'error') => {
            const message = fallbackMessage || normalizeMessage(error);
            console.error('[API]', message, error);
            showToast(message, variant);
        },
        [showToast],
    );
};

export default useNotifyApiError;
