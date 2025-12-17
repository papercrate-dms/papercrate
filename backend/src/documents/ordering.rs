use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const UNICODE_COLLATION_NAME: &str = "unicode_ci";
pub const UNICODE_COLLATION_LOCALE: &str = "und-u-ks-level2";

const TITLE_ASC: &str = "title COLLATE \"unicode_ci\" ASC";
const TITLE_DESC: &str = "title COLLATE \"unicode_ci\" DESC";
const ISSUED_AT_ASC: &str = "issued_at ASC NULLS LAST";
const ISSUED_AT_DESC: &str = "issued_at DESC NULLS LAST";
const CREATED_AT_ASC: &str = "created_at ASC";
const CREATED_AT_DESC: &str = "created_at DESC";
const UPDATED_AT_ASC: &str = "updated_at ASC";
const UPDATED_AT_DESC: &str = "updated_at DESC";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentSortField {
    Title,
    IssuedAt,
    CreatedAt,
    UpdatedAt,
}

impl Default for DocumentSortField {
    fn default() -> Self {
        DocumentSortField::Title
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl Default for SortDirection {
    fn default() -> Self {
        SortDirection::Asc
    }
}

pub fn ordering_clauses(
    field: DocumentSortField,
    direction: SortDirection,
) -> (&'static str, Option<&'static str>) {
    match (field, direction) {
        (DocumentSortField::Title, SortDirection::Asc) => (TITLE_ASC, None),
        (DocumentSortField::Title, SortDirection::Desc) => (TITLE_DESC, None),
        (DocumentSortField::IssuedAt, SortDirection::Asc) => (ISSUED_AT_ASC, Some(TITLE_ASC)),
        (DocumentSortField::IssuedAt, SortDirection::Desc) => (ISSUED_AT_DESC, Some(TITLE_ASC)),
        (DocumentSortField::CreatedAt, SortDirection::Asc) => (CREATED_AT_ASC, Some(TITLE_ASC)),
        (DocumentSortField::CreatedAt, SortDirection::Desc) => (CREATED_AT_DESC, Some(TITLE_ASC)),
        (DocumentSortField::UpdatedAt, SortDirection::Asc) => (UPDATED_AT_ASC, Some(TITLE_ASC)),
        (DocumentSortField::UpdatedAt, SortDirection::Desc) => (UPDATED_AT_DESC, Some(TITLE_ASC)),
    }
}
