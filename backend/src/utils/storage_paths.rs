//! Document storage path helpers.
//!
//! NOTE: The path layout produced here is part of the durable storage contract.
//! External systems (presigned URLs, lifecycle jobs, migrations) expect the
//! `documents/{document_id}/...` structure to remain stable. Coordinate before
//! changing any of these helpers to avoid breaking compatibility with existing
//! objects.

use uuid::Uuid;

const DOCUMENTS_PREFIX: &str = "documents";

/// Returns the root prefix for all objects belonging to a document.
pub fn document_prefix(document_id: Uuid) -> String {
    format!("{DOCUMENTS_PREFIX}/{document_id}")
}

/// Returns the prefix for a specific document version (without the object id).
pub fn document_version_prefix(document_id: Uuid, version_number: i32) -> String {
    format!("{}/v{}", document_prefix(document_id), version_number)
}

/// Returns the storage key for a stored document version blob.
pub fn document_version_object_key(
    document_id: Uuid,
    version_number: i32,
    version_id: Uuid,
) -> String {
    format!(
        "{}/{}",
        document_version_prefix(document_id, version_number),
        version_id
    )
}

fn document_asset_prefix(document_id: Uuid, version_number: i32) -> String {
    format!(
        "{}/assets",
        document_version_prefix(document_id, version_number)
    )
}

fn document_asset_type_prefix(document_id: Uuid, version_number: i32, asset_type: &str) -> String {
    format!(
        "{}/{}",
        document_asset_prefix(document_id, version_number),
        asset_type
    )
}

/// Returns the storage key for an asset (single object).
pub fn document_asset_key(
    document_id: Uuid,
    version_number: i32,
    asset_type: &str,
    asset_id: Uuid,
) -> String {
    format!(
        "{}/{}",
        document_asset_type_prefix(document_id, version_number, asset_type),
        asset_id
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_expected_paths() {
        let document_id = Uuid::nil();
        let version_id = Uuid::nil();
        let asset_id = Uuid::nil();

        assert_eq!(
            document_prefix(document_id),
            format!("documents/{document_id}")
        );

        assert_eq!(
            document_version_prefix(document_id, 3),
            format!("documents/{document_id}/v3")
        );

        assert_eq!(
            document_version_object_key(document_id, 3, version_id),
            format!("documents/{document_id}/v3/{version_id}")
        );

        assert_eq!(
            document_asset_key(document_id, 3, "thumbnail", asset_id),
            format!("documents/{document_id}/v3/assets/thumbnail/{asset_id}")
        );
    }
}
