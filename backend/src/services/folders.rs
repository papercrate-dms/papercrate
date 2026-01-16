use std::collections::HashMap;

use diesel::pg::PgConnection;
use diesel::{
    dsl::{exists, sql},
    prelude::*,
    sql_types::Text,
    Connection,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::documents::ordering::{ordering_clauses, DocumentSortField, SortDirection};
use crate::error::{AppError, AppResult};
use crate::http::responders::{IntoAppResult, RowsAffectedExt};
use crate::models::{Document, Folder, NewFolder};
use crate::schema::{documents, folders};
use crate::services::documents::{DocumentResponse, DocumentsService};
use crate::state::AppState;
use crate::utils::{json::deserialize_patch_field, text::normalize_identifier, time::to_iso};

const MAX_FOLDER_NAME_LEN: usize = 255;

#[derive(Deserialize, ToSchema)]
pub struct CreateFolderRequest {
    pub name: String,
    #[schema(nullable)]
    pub parent_id: Option<Uuid>,
}

#[derive(Deserialize, ToSchema)]
pub struct EnsureFolderPathRequest {
    #[schema(nullable)]
    pub parent_id: Option<Uuid>,
    pub segments: Vec<String>,
}

#[derive(Serialize, ToSchema, Clone, Debug)]
pub struct FolderInfo {
    pub id: Uuid,
    pub name: String,
    #[schema(nullable)]
    pub parent_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize, ToSchema)]
pub struct FolderTreeNode {
    pub id: Uuid,
    pub name: String,
    #[schema(nullable)]
    pub parent_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub children: Vec<FolderTreeNode>,
}

#[derive(Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct FolderContentsQuery {
    #[serde(default = "default_include_documents")]
    #[schema(default = true)]
    pub include_documents: bool,
    #[serde(default)]
    #[schema(default = "title")]
    pub sort: DocumentSortField,
    #[serde(default)]
    #[schema(default = "asc")]
    pub dir: SortDirection,
}

#[derive(Default, Deserialize, ToSchema)]
pub struct UpdateFolderRequest {
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    #[schema(nullable, value_type = Option<Uuid>)]
    pub parent_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    #[schema(nullable)]
    pub name: Option<Option<String>>,
}

pub struct FolderContentsData {
    pub folder: Option<FolderInfo>,
    pub subfolders: Vec<FolderInfo>,
    pub documents: Vec<Document>,
}

pub struct FolderService<'a> {
    state: &'a AppState,
}

impl<'a> FolderService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn get_folder(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        folder_id: Uuid,
    ) -> AppResult<FolderInfo> {
        let folder: Folder = folders::table
            .find(folder_id)
            .filter(folders::tenant_id.eq(tenant_id))
            .first(conn)?;
        Ok(folder_to_info(folder))
    }

    pub fn ensure_folder_path(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        payload: EnsureFolderPathRequest,
    ) -> AppResult<FolderInfo> {
        if payload.segments.is_empty() {
            return Err(AppError::bad_request("segments must not be empty"));
        }

        let folder = conn.transaction::<Folder, AppError, _>(|conn| {
            let mut current_parent = payload.parent_id;
            let mut last_folder: Option<Folder> = None;

            for raw_name in &payload.segments {
                let name = normalize_folder_name(raw_name, "folder names must not be empty")?;

                let existing: Option<Folder> = if let Some(parent_id) = current_parent {
                    folders::table
                        .filter(folders::tenant_id.eq(tenant_id))
                        .filter(folders::parent_id.eq(Some(parent_id)))
                        .filter(folders::name.eq(&name))
                        .first(conn)
                        .optional()?
                } else {
                    folders::table
                        .filter(folders::tenant_id.eq(tenant_id))
                        .filter(folders::parent_id.is_null())
                        .filter(folders::name.eq(&name))
                        .first(conn)
                        .optional()?
                };

                let folder = if let Some(folder) = existing {
                    folder
                } else {
                    let new_folder = NewFolder {
                        id: Uuid::new_v4(),
                        name: name.clone(),
                        parent_id: current_parent,
                        tenant_id,
                    };

                    let inserted_id: Option<Uuid> = diesel::insert_into(folders::table)
                        .values(&new_folder)
                        .on_conflict_do_nothing()
                        .returning(folders::id)
                        .get_result(conn)
                        .optional()?;

                    if let Some(id) = inserted_id {
                        folders::table
                            .find(id)
                            .filter(folders::tenant_id.eq(tenant_id))
                            .first(conn)?
                    } else if let Some(parent_id) = current_parent {
                        folders::table
                            .filter(folders::tenant_id.eq(tenant_id))
                            .filter(folders::parent_id.eq(Some(parent_id)))
                            .filter(folders::name.eq(&name))
                            .first(conn)?
                    } else {
                        folders::table
                            .filter(folders::tenant_id.eq(tenant_id))
                            .filter(folders::parent_id.is_null())
                            .filter(folders::name.eq(&name))
                            .first(conn)?
                    }
                };

                current_parent = Some(folder.id);
                last_folder = Some(folder);
            }

            last_folder.ok_or_else(|| AppError::internal("failed to resolve folder path"))
        })?;

        Ok(folder_to_info(folder))
    }

    pub fn create_folder(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        payload: CreateFolderRequest,
    ) -> AppResult<(FolderInfo, bool)> {
        let name = normalize_folder_name(&payload.name, "name must not be empty")?;

        let existing: Option<Folder> = if let Some(parent_id) = payload.parent_id {
            folders::table
                .filter(folders::tenant_id.eq(tenant_id))
                .filter(folders::parent_id.eq(Some(parent_id)))
                .filter(folders::name.eq(&name))
                .first(conn)
                .optional()?
        } else {
            folders::table
                .filter(folders::tenant_id.eq(tenant_id))
                .filter(folders::parent_id.is_null())
                .filter(folders::name.eq(&name))
                .first(conn)
                .optional()?
        };

        let (folder, created) = if let Some(folder) = existing {
            (folder, false)
        } else {
            let new_folder = NewFolder {
                id: Uuid::new_v4(),
                name: name.clone(),
                parent_id: payload.parent_id,
                tenant_id,
            };

            let inserted_id: Option<Uuid> = diesel::insert_into(folders::table)
                .values(&new_folder)
                .on_conflict_do_nothing()
                .returning(folders::id)
                .get_result(conn)
                .optional()?;

            if let Some(id) = inserted_id {
                (
                    folders::table
                        .find(id)
                        .filter(folders::tenant_id.eq(tenant_id))
                        .first(conn)?,
                    true,
                )
            } else if let Some(parent_id) = payload.parent_id {
                (
                    folders::table
                        .filter(folders::tenant_id.eq(tenant_id))
                        .filter(folders::parent_id.eq(Some(parent_id)))
                        .filter(folders::name.eq(&name))
                        .first(conn)?,
                    false,
                )
            } else {
                (
                    folders::table
                        .filter(folders::tenant_id.eq(tenant_id))
                        .filter(folders::parent_id.is_null())
                        .filter(folders::name.eq(&name))
                        .first(conn)?,
                    false,
                )
            }
        };

        Ok((folder_to_info(folder), created))
    }

    pub fn list_folder_contents(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        folder_id: Option<Uuid>,
        sort: DocumentSortField,
        dir: SortDirection,
        include_documents: bool,
    ) -> AppResult<FolderContentsData> {
        let folder = match folder_id {
            Some(id) => Some(folder_to_info(
                folders::table
                    .find(id)
                    .filter(folders::tenant_id.eq(tenant_id))
                    .first::<Folder>(conn)?,
            )),
            None => None,
        };

        let child_folders: Vec<Folder> = if let Some(parent_id) = folder_id {
            folders::table
                .filter(folders::parent_id.eq(parent_id))
                .filter(folders::tenant_id.eq(tenant_id))
                .order(sql::<Text>("name COLLATE \"unicode_ci\" ASC"))
                .load(conn)?
        } else {
            folders::table
                .filter(folders::parent_id.is_null())
                .filter(folders::tenant_id.eq(tenant_id))
                .order(sql::<Text>("name COLLATE \"unicode_ci\" ASC"))
                .load(conn)?
        };

        let subfolders = child_folders.into_iter().map(folder_to_info).collect();

        let documents = if include_documents {
            let mut docs_query = documents::table
                .filter(documents::deleted_at.is_null())
                .filter(documents::tenant_id.eq(tenant_id))
                .into_boxed();

            let (primary_sql, secondary_sql) = ordering_clauses(sort, dir);
            docs_query = docs_query.order(sql::<Text>(primary_sql));
            if let Some(second) = secondary_sql {
                docs_query = docs_query.then_order_by(sql::<Text>(second));
            }

            if let Some(current_folder) = folder_id {
                docs_query
                    .filter(documents::folder_id.eq(current_folder))
                    .load::<Document>(conn)?
            } else {
                docs_query
                    .filter(documents::folder_id.is_null())
                    .load::<Document>(conn)?
            }
        } else {
            Vec::new()
        };

        Ok(FolderContentsData {
            folder,
            subfolders,
            documents,
        })
    }

    pub fn list_folder_tree(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
    ) -> AppResult<Vec<FolderTreeNode>> {
        let folders: Vec<Folder> = folders::table
            .filter(folders::tenant_id.eq(tenant_id))
            .order(sql::<Text>("name COLLATE \"unicode_ci\" ASC"))
            .load(conn)?;

        let mut node_map: HashMap<Uuid, FolderTreeNode> = HashMap::with_capacity(folders.len());
        let mut children_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        let mut roots: Vec<Uuid> = Vec::new();

        for folder in folders {
            let id = folder.id;
            let parent_id = folder.parent_id;
            let node = FolderTreeNode {
                id,
                name: folder.name,
                parent_id,
                created_at: to_iso(folder.created_at),
                updated_at: to_iso(folder.updated_at),
                children: Vec::new(),
            };

            if let Some(parent) = parent_id {
                children_map.entry(parent).or_default().push(id);
            } else {
                roots.push(id);
            }

            node_map.insert(id, node);
        }

        fn build_node(
            id: Uuid,
            nodes: &HashMap<Uuid, FolderTreeNode>,
            child_map: &HashMap<Uuid, Vec<Uuid>>,
        ) -> FolderTreeNode {
            let mut node = nodes.get(&id).cloned().expect("folder node must exist");

            if let Some(children) = child_map.get(&id) {
                node.children = children
                    .iter()
                    .map(|child_id| build_node(*child_id, nodes, child_map))
                    .collect();
            }

            node
        }

        let tree = roots
            .iter()
            .map(|root_id| build_node(*root_id, &node_map, &children_map))
            .collect();

        Ok(tree)
    }

    pub fn delete_folder(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        folder_id: Uuid,
    ) -> AppResult<()> {
        conn.transaction::<_, AppError, _>(|conn| {
            folders::table
                .find(folder_id)
                .filter(folders::tenant_id.eq(tenant_id))
                .first::<Folder>(conn)?;

            let has_child_folders: bool = diesel::select(exists(
                folders::table
                    .filter(folders::parent_id.eq(Some(folder_id)))
                    .filter(folders::tenant_id.eq(tenant_id)),
            ))
            .get_result(conn)?;

            if has_child_folders {
                return Err(AppError::bad_request(
                    "folder must be empty before deletion",
                ));
            }

            let has_documents: bool = diesel::select(exists(
                documents::table
                    .filter(documents::folder_id.eq(Some(folder_id)))
                    .filter(documents::tenant_id.eq(tenant_id))
                    .filter(documents::deleted_at.is_null()),
            ))
            .get_result(conn)?;

            if has_documents {
                return Err(AppError::bad_request(
                    "folder must be empty before deletion",
                ));
            }

            diesel::delete(
                folders::table
                    .filter(folders::id.eq(folder_id))
                    .filter(folders::tenant_id.eq(tenant_id)),
            )
            .execute(conn)
            .into_app_result()?
            .or_not_found()?;

            Ok(())
        })
    }

    pub fn update_folder(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        folder_id: Uuid,
        payload: UpdateFolderRequest,
    ) -> AppResult<()> {
        conn.transaction::<_, AppError, _>(|conn| {
            let folder: Folder = folders::table
                .find(folder_id)
                .filter(folders::tenant_id.eq(tenant_id))
                .first(conn)?;

            let mut next_parent = folder.parent_id;
            let mut parent_changed = false;
            match payload.parent_id {
                None => {}
                Some(None) => {
                    if folder.parent_id.is_some() {
                        parent_changed = true;
                    }
                    next_parent = None;
                }
                Some(Some(parent_id)) => {
                    if parent_id == folder_id {
                        return Err(AppError::bad_request("folder cannot be its own parent"));
                    }

                    folders::table
                        .find(parent_id)
                        .filter(folders::tenant_id.eq(tenant_id))
                        .first::<Folder>(conn)?;

                    if folder.parent_id != Some(parent_id) {
                        let descendant_ids =
                            gather_descendant_folder_ids(conn, tenant_id, folder_id)?;
                        if descendant_ids.contains(&parent_id) {
                            return Err(AppError::bad_request(
                                "cannot move folder into itself or a descendant",
                            ));
                        }
                        parent_changed = true;
                    }

                    next_parent = Some(parent_id);
                }
            }

            let mut new_name = folder.name.clone();
            let mut name_changed = false;
            match payload.name {
                None => {}
                Some(None) => {
                    return Err(AppError::bad_request("name cannot be null"));
                }
                Some(Some(value)) => {
                    let normalized = normalize_folder_name(&value, "name must not be empty")?;

                    if normalized != folder.name {
                        new_name = normalized;
                        name_changed = true;
                    }
                }
            }

            if !parent_changed && !name_changed {
                return Ok(());
            }

            let conflict = if let Some(parent_id) = next_parent {
                folders::table
                    .filter(folders::parent_id.eq(Some(parent_id)))
                    .filter(folders::name.eq(&new_name))
                    .filter(folders::id.ne(folder_id))
                    .filter(folders::tenant_id.eq(tenant_id))
                    .first::<Folder>(conn)
                    .optional()?
            } else {
                folders::table
                    .filter(folders::parent_id.is_null())
                    .filter(folders::name.eq(&new_name))
                    .filter(folders::id.ne(folder_id))
                    .filter(folders::tenant_id.eq(tenant_id))
                    .first::<Folder>(conn)
                    .optional()?
            };

            if conflict.is_some() {
                return Err(AppError::bad_request(
                    "a folder with the same name already exists in the target",
                ));
            }

            diesel::update(
                folders::table
                    .find(folder_id)
                    .filter(folders::tenant_id.eq(tenant_id)),
            )
            .set((
                folders::parent_id.eq(next_parent),
                folders::name.eq(&new_name),
            ))
            .execute(conn)
            .into_app_result()?
            .or_not_found()?;

            Ok(())
        })
    }

    pub fn hydrate_documents(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        docs: Vec<Document>,
    ) -> AppResult<Vec<DocumentResponse>> {
        DocumentsService::new(self.state).hydrate_documents(conn, tenant_id, user_id, docs)
    }
}

pub fn gather_descendant_folder_ids(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    folder_id: Uuid,
) -> AppResult<Vec<Uuid>> {
    let mut ids = vec![folder_id];
    let mut queue = vec![folder_id];

    while let Some(current) = queue.pop() {
        let child_ids: Vec<Uuid> = folders::table
            .filter(folders::parent_id.eq(Some(current)))
            .filter(folders::tenant_id.eq(tenant_id))
            .select(folders::id)
            .load(conn)?;
        queue.extend(child_ids.iter().copied());
        ids.extend(child_ids);
    }

    Ok(ids)
}

fn folder_to_info(folder: Folder) -> FolderInfo {
    FolderInfo {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: to_iso(folder.created_at),
        updated_at: to_iso(folder.updated_at),
    }
}

fn normalize_folder_name(value: &str, empty_message: &str) -> AppResult<String> {
    normalize_identifier(
        value,
        MAX_FOLDER_NAME_LEN,
        empty_message,
        "folder name must not exceed 255 characters",
        Some("folder name may only contain printable characters"),
        |ch| !ch.is_control(),
    )
}

const fn default_include_documents() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::UpdateFolderRequest;
    use serde_json::json;

    #[test]
    fn update_folder_request_deserializes_null_parent() {
        let req: UpdateFolderRequest =
            serde_json::from_value(json!({ "parent_id": null })).unwrap();
        assert!(matches!(req.parent_id, Some(None)));
    }

    #[test]
    fn update_folder_request_deserializes_absent_parent() {
        let req: UpdateFolderRequest = serde_json::from_value(json!({})).unwrap();
        assert!(req.parent_id.is_none());
    }

    #[test]
    fn update_folder_request_deserializes_null_name() {
        let req: UpdateFolderRequest = serde_json::from_value(json!({ "name": null })).unwrap();
        assert!(matches!(req.name, Some(None)));
    }
}
