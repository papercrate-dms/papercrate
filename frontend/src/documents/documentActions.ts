import type { Document } from '../types/documents';

export const resolveDocumentDownloadHref = (document?: Document | null): string | null => {
  if (!document) {
    return null;
  }
  const download = document.current_version?.download;
  if (!download?.url) {
    return null;
  }
  if (download.expires_at && download.expires_at <= Date.now()) {
    return null;
  }
  return download.url;
};
