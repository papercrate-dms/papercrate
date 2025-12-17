import { useCallback } from 'react';

type ApiLogger = Pick<typeof console, 'error'>;

type ApiErrorVariant = 'error' | 'info' | 'success' | 'warning' | string;

interface ReportPayload {
  message: string;
  variant: ApiErrorVariant;
  retry?: (() => void) | null;
  error: unknown;
}

interface UseApiErrorOptions {
  logger?: ApiLogger;
  onReport?: (payload: ReportPayload) => void;
}

export const normalizeMessage = (error: unknown): string => {
  if (!error) return 'Something went wrong.';
  if (typeof (error as { trim?: () => string })?.trim === 'function') {
    return (error as { trim: () => string }).trim();
  }
  const typed = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
  if (typed.response?.data?.error) return typed.response.data.error;
  if (typed.response?.data?.message) return typed.response.data.message;
  return typed.message || 'Something went wrong.';
};

const useApiError = ({
  logger = console,
  onReport,
}: UseApiErrorOptions = {}) => {
  return useCallback(
    (
      error: unknown,
      { message, variant = 'error', retry = null }: { message?: string; variant?: ApiErrorVariant; retry?: (() => void) | null } = {},
    ) => {
      const normalizedMessage = message || normalizeMessage(error);
      logger.error('[API]', normalizedMessage, error);
      if (onReport) {
        onReport({ message: normalizedMessage, variant, retry, error });
      }
      return normalizedMessage;
    },
    [logger, onReport],
  );
};

export default useApiError;
