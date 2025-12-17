const ensureDate = (value: string | Date | null): Date | null => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

interface FormatOptions {
  fallback?: string;
  locale?: Intl.LocalesArgument;
  options?: Intl.DateTimeFormatOptions;
}

export const formatDate = (value: string | Date | null, { fallback = '—', locale, options }: FormatOptions = {}): string => {
  const date = ensureDate(value);
  if (!date) {
    return fallback;
  }
  return date.toLocaleDateString(locale, options);
};

export const formatDateTime = (value: string | Date | null, { fallback = '—', locale, options }: FormatOptions = {}): string => {
  const date = ensureDate(value);
  if (!date) {
    return fallback;
  }
  return date.toLocaleString(locale, options);
};

export const toDateInputValue = (value: string | Date | null): string => {
  const date = ensureDate(value);
  if (!date) {
    return '';
  }
  const timezoneOffset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - timezoneOffset * 60000);
  return localDate.toISOString().slice(0, 10);
};

export const toIssuedTimestamp = (dateString: string | null, fallback: string | Date | null): string | null => {
  if (!dateString) {
    return null;
  }
  const base = ensureDate(fallback) || new Date();
  const [year, month, day] = dateString.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return null;
  }
  const candidate = new Date(base);
  candidate.setUTCFullYear(year, month - 1, day);
  return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
};
