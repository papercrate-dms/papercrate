export const composeClassName = (base: string, extra?: string | null): string =>
  extra ? `${base} ${extra}` : base;
