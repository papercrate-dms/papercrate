export const DEFAULT_THUMBNAIL_SIZE = 48;

export const TAG_MIME_TYPES = ['application/x-papercrate-tag', 'text/papercrate-tag'] as const;
export const TAG_TEXT_MIME_TYPE = 'text/plain';

export const DEFAULT_GRID_ICON_SIZE = 144;
export const DEFAULT_LIST_ICON_SIZE = 48;
export const DEFAULT_DESKTOP_CARD_SIZE = 300;

export const SORT_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'issued_at', label: 'Issued date' },
  { value: 'created_at', label: 'Added' },
  { value: 'updated_at', label: 'Updated date' },
] as const;

export const SORT_LABEL_LOOKUP = SORT_OPTIONS.reduce<Record<string, string>>((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});
