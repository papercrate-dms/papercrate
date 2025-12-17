import type { FolderTreeNode } from '../lib/api/apiTypes';
import {
  DEFAULT_FOLDER_NAME,
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_FIELD,
  SORT_FIELD_VALUES,
  TAG_FILTER_UNTAGGED,
} from '../constants/workspace';

export {
  DEFAULT_FOLDER_NAME,
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_FIELD,
  SORT_FIELD_VALUES,
  TAG_FILTER_UNTAGGED,
};

export const hasFiles = (event) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

const mergeAssetIntoGroup = (group, assetData) => {
  if (!assetData || !assetData.asset_type) {
    return group || [];
  }

  const list = Array.isArray(group) ? group : [];
  const index = list.findIndex((item) => item?.asset_type === assetData.asset_type);
  if (index >= 0) {
    const next = list.slice();
    next[index] = assetData;
    return next;
  }
  return list.concat(assetData);
};

export const mergeAssetIntoDocument = (doc, assetData) => {
  if (!doc) return doc;
  const nextGroup = mergeAssetIntoGroup(doc.current_version?.assets, assetData);
  return {
    ...doc,
    current_version: { ...(doc.current_version || {}), assets: nextGroup },
  };
};

export const createRootNode = () => ({
  id: 'root',
  name: DEFAULT_FOLDER_NAME,
  parentId: null,
  children: [],
  expanded: true,
  loaded: false,
  hasChildren: false,
});

export const flattenFolderTree = (data: FolderTreeNode[]): FolderTreeNode[] => {
  const result: FolderTreeNode[] = [];
  data.forEach((item) => {
    result.push(item);
    if (item.children) {
      result.push(...flattenFolderTree(item.children));
    }
  });
  return result;
};
