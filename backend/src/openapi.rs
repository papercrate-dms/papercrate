use utoipa::openapi::{self, tag::TagBuilder, InfoBuilder};
use utoipa::OpenApi;

pub struct ApiDoc;

impl OpenApi for ApiDoc {
    fn openapi() -> openapi::OpenApi {
        let mut doc = crate::routes::health::HealthApiDoc::openapi();
        doc.merge(crate::routes::auth::AuthApiDoc::openapi());
        doc.merge(crate::routes::documents::DocumentsApiDoc::openapi());
        doc.merge(crate::routes::folders::FoldersApiDoc::openapi());
        doc.merge(crate::routes::tags::TagsApiDoc::openapi());
        doc.merge(crate::routes::correspondents::CorrespondentsApiDoc::openapi());
        doc.merge(crate::routes::profile::ProfileApiDoc::openapi());
        doc.merge(crate::routes::capability_sets::CapabilitySetsApiDoc::openapi());
        doc.merge(crate::routes::tenants::TenantsApiDoc::openapi());

        doc.info = InfoBuilder::new()
            .title("Papercrate API")
            .version(env!("CARGO_PKG_VERSION"))
            .build();

        doc.tags = Some(vec![
            TagBuilder::new()
                .name("Health")
                .description(Some("Service health"))
                .build(),
            TagBuilder::new()
                .name("Auth")
                .description(Some("Authentication"))
                .build(),
            TagBuilder::new()
                .name("Documents")
                .description(Some("Document management"))
                .build(),
            TagBuilder::new()
                .name("Assets")
                .description(Some("Document assets"))
                .build(),
            TagBuilder::new()
                .name("Folders")
                .description(Some("Folder management"))
                .build(),
            TagBuilder::new()
                .name("Tags")
                .description(Some("Tag catalog"))
                .build(),
            TagBuilder::new()
                .name("Correspondents")
                .description(Some("Correspondent catalog"))
                .build(),
            TagBuilder::new()
                .name("Profile")
                .description(Some("User profile and WebDAV tokens"))
                .build(),
            TagBuilder::new()
                .name("Capability Sets")
                .description(Some("Capability set management"))
                .build(),
            TagBuilder::new()
                .name("Tenants")
                .description(Some("Tenant catalog"))
                .build(),
        ]);

        doc
    }
}

pub mod schemas {
    pub use crate::auth::passkeys::{
        AuthenticationChallengeResponse, PasskeyLoginFinishPayload, PasskeyLoginStartPayload,
        PasskeyRegistrationFinishPayload, PasskeySummary, RegistrationChallengeResponse,
    };
    pub use crate::auth::AuthenticatedUser;
    pub use crate::documents::asset::{
        DocumentAssetDetailResponse, DocumentAssetResponse, DocumentVersionDetailResponse,
        DocumentVersionResponse,
    };
    pub use crate::documents::correspondents::DocumentCorrespondentResponse;
    pub use crate::error::ApiErrorResponse;
    pub use crate::models::ApiCapability;
    pub use crate::routes::correspondents::{
        CorrespondentSummary, CreateCorrespondentRequest,
        UpdateCorrespondentRequest,
    };
    pub use crate::routes::documents::{
        AssetRequestQuery, DocumentCheckQuery, MoveDocumentRequest, RestoreDocumentRequest,
        UploadDocumentForm,
    };
    pub use crate::routes::folders::FolderContentsResponse;
    pub use crate::routes::tags::{CreateTagRequest, TagCatalogEntry, UpdateTagRequest};
    pub use crate::services::auth::{
        ApiTokenExchangeRequest, LoginRequest, LoginResponse, LoginResponseVariants,
        SignupFinishRequest, SignupStartRequest, SignupStartResponse, TenantListResponse,
        TenantSelectionRequest, TenantSelectionResponse, TenantSnippet,
    };
    pub use crate::services::capability_sets::{
        CapabilitySetResponse, CreateCapabilitySetRequest, UpdateCapabilitySetRequest,
    };
    pub use crate::services::correspondents::{
        AssignCorrespondentsRequest, BulkCorrespondentAction, BulkCorrespondentResponse,
        BulkCorrespondentsRequest, CorrespondentAssignmentInput,
    };
    pub use crate::services::documents::{
        BulkMoveRequest, BulkMoveResponse, BulkReanalyzeResponse, BulkReanalyzeSelectionRequest,
        DocumentCheckResponse, DocumentDetailResponse, DocumentListQuery, DocumentMetadataUpdate,
        DocumentResponse, DocumentStatusFilter, TagResponse, UpdateDocumentRequest,
    };
    pub use crate::services::folders::{
        CreateFolderRequest, EnsureFolderPathRequest, FolderContentsQuery, FolderInfo,
        UpdateFolderRequest,
    };
    pub use crate::services::profile::{
        ApiTokenCreatedResponse, ApiTokenResponse, CreateApiTokenRequest, RevokePasskeyQuery,
    };
    pub use crate::services::tags::{
        AssignTagsRequest, BulkTagAction, BulkTagRequest, BulkTagResponse,
    };
    pub use crate::services::tenants::{
        TenantUserListResponse, TenantUserSummary, UpdateTenantRequest, UpdateTenantUserRequest,
    };
}

#[cfg(test)]
mod tests {
    use super::ApiDoc;
    use utoipa::OpenApi;

    #[test]
    fn openapi_serializes() {
        let spec = ApiDoc::openapi();
        let _ = serde_json::to_string(&spec).expect("serialize openapi");
    }
}
