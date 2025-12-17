import type { Identifier } from '../../types/identifiers';
import type { Asset } from '../../types/assets';
import type { DocumentVersion, Document } from '../../types/documents';

type Nullable<T> = T | null;

export type { Asset };

const resolveAssetExpiresAt = (asset?: { download?: { expires_at: number } | null } | null): number | null =>
  asset?.download?.expires_at ?? null;

export const resolveAssetUrl = (asset?: { download?: { url: string } | null } | null): string | null =>
  asset?.download?.url ?? null;

export type EnsureAssetUrl = (
  documentId: Identifier,
  asset: Asset,
  options?: { force?: boolean;[key: string]: unknown },
) => Promise<unknown>;

export type GetAsset = (document: Document, assetType: string) => Nullable<Asset>;

const getAssetFromGroup = (
  assets?: Asset[] | Record<string, Asset> | null,
  assetType: string = '',
): Nullable<Asset> => {
  if (!assetType || !assets) {
    return null;
  }

  if (Array.isArray(assets)) {
    return assets.find((entry) => entry?.asset_type === assetType) || null;
  }

  return assets?.[assetType] || null;
};

export const getAssetFromVersion = (currentVersion: Nullable<DocumentVersion>, assetType: string) => {
  if (!currentVersion) {
    return null;
  }
  return getAssetFromGroup(currentVersion.assets, assetType);
};



export const resolveDocumentAssetUrl = (
  doc: Nullable<Document>,
  type: string,
  {
    ensureAssetUrl,
    getAsset,
    ensureOptions,
  }: {
    ensureAssetUrl?: EnsureAssetUrl;
    getAsset?: GetAsset;
    ensureOptions?: { force?: boolean;[key: string]: unknown };
  } = {},
): Nullable<string> => {
  if (!doc || !type) {
    return null;
  }
  const asset = getAsset ? getAsset(doc, type) : null;
  if (!asset) {
    return null;
  }
  const url = resolveAssetUrl(asset);
  const expiresAt = resolveAssetExpiresAt(asset);
  const now = Date.now();
  if (url && (!expiresAt || expiresAt > now)) {
    return url;
  }
  if (doc.id && asset.id && ensureAssetUrl) {
    const force = Boolean(url && expiresAt && expiresAt <= now);
    const options: { force: boolean;[key: string]: unknown } = {
      force,
      ...(ensureOptions || {}),
    };
    ensureAssetUrl(doc.id, asset, options).catch(() => { });
  }
  return null;
};

class AssetManager {
  fetchAsset: ((id: Identifier) => Promise<Asset | null>) | null;

  assetCache: Map<Identifier, Asset>;
  assetInflight: Map<string, Promise<Asset | null>>;

  constructor({ fetchAsset }: { fetchAsset: ((id: Identifier) => Promise<Asset | null>) | null }) {
    this.fetchAsset = fetchAsset;
    this.assetCache = new Map();
    this.assetInflight = new Map();
  }

  setFetchAsset(fetchAsset: ((id: Identifier) => Promise<Asset | null>) | null) {
    this.fetchAsset = fetchAsset;
  }

  rememberAsset(entry?: Nullable<Asset>) {
    if (entry?.id) {
      this.assetCache.set(entry.id, entry);
    }
  }

  ensureAsset(
    documentId?: Identifier | null,
    asset?: Nullable<Asset>,
    { force = false }: { force?: boolean } = {},
  ): Promise<Nullable<Asset>> {
    if (!documentId || !asset?.id) {
      return Promise.resolve(asset);
    }

    const baseAsset = this.assetCache.get(asset.id) || asset;
    const assetExpiresAt = resolveAssetExpiresAt(baseAsset);
    const now = Date.now();

    const isPrimarySatisfied = () => {
      const assetUrl = resolveAssetUrl(baseAsset);
      if (assetUrl && (!assetExpiresAt || assetExpiresAt > now)) {
        return true;
      }
      return false;
    };

    let needsFetch = force;
    if (!needsFetch) {
      needsFetch = !isPrimarySatisfied();
    }

    if (!needsFetch) {
      this.rememberAsset(baseAsset);
      return Promise.resolve(baseAsset);
    }

    const inflightKey = `${documentId}:${asset.id}`;
    if (!force && this.assetInflight.has(inflightKey)) {
      return this.assetInflight.get(inflightKey);
    }

    if (!this.fetchAsset) {
      return Promise.reject(new Error('AssetManager fetcher is not configured.'));
    }

    const request: Promise<Asset | null> = this.fetchAsset(asset.id)
      .then((data) => {
        if (!data) return null;
        const cachedEntry = this.assetCache.get(asset.id) || baseAsset;
        const combined = { ...cachedEntry, ...asset, ...data };
        const expires_at = resolveAssetExpiresAt(combined);
        const entry = {
          ...combined,
          url: resolveAssetUrl(combined),
          expires_at,
        };

        this.rememberAsset(entry);
        return entry;
      })
      .finally(() => {
        this.assetInflight.delete(inflightKey);
      });

    this.assetInflight.set(inflightKey, request);
    return request;
  }

  reset() {
    this.assetCache.clear();
    this.assetInflight.clear();
  }
}

export default AssetManager;
