// @generated automatically by Diesel CLI.

pub mod sql_types {
    #[derive(diesel::query_builder::QueryId, Clone, diesel::sql_types::SqlType)]
    #[diesel(postgres_type(name = "magic_token_kind"))]
    pub struct MagicTokenKind;

    #[derive(diesel::query_builder::QueryId, Clone, diesel::sql_types::SqlType)]
    #[diesel(postgres_type(name = "tenant_status"))]
    pub struct TenantStatus;

    #[derive(diesel::query_builder::QueryId, Clone, diesel::sql_types::SqlType)]
    #[diesel(postgres_type(name = "api_capability"))]
    pub struct ApiCapability;
}

diesel::table! {
    correspondents (id) {
        id -> Uuid,
        #[max_length = 255]
        name -> Varchar,
        metadata -> Jsonb,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    document_assets (id) {
        id -> Uuid,
        document_version_id -> Uuid,
        asset_type -> Text,
        mime_type -> Text,
        metadata -> Jsonb,
        created_at -> Timestamptz,
        s3_key -> Text,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    document_correspondents (document_id, correspondent_id) {
        document_id -> Uuid,
        correspondent_id -> Uuid,
        assigned_at -> Timestamptz,
        assigned_by -> Nullable<Uuid>,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    document_tags (document_id, tag_id) {
        document_id -> Uuid,
        tag_id -> Uuid,
        assigned_at -> Timestamptz,
        assigned_by -> Nullable<Uuid>,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    document_versions (id) {
        id -> Uuid,
        document_id -> Uuid,
        version_number -> Int4,
        #[max_length = 500]
        s3_key -> Varchar,
        size_bytes -> Int8,
        #[max_length = 64]
        checksum -> Varchar,
        created_at -> Timestamptz,
        metadata -> Jsonb,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    documents (id) {
        id -> Uuid,
        #[max_length = 255]
        filename -> Varchar,
        #[max_length = 255]
        original_name -> Varchar,
        #[max_length = 100]
        mime_type -> Nullable<Varchar>,
        folder_id -> Nullable<Uuid>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        deleted_at -> Nullable<Timestamptz>,
        metadata -> Jsonb,
        issued_at -> Nullable<Timestamptz>,
        #[max_length = 255]
        title -> Varchar,
        current_version_id -> Uuid,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    folders (id) {
        id -> Uuid,
        #[max_length = 255]
        name -> Varchar,
        parent_id -> Nullable<Uuid>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    jobs (id) {
        id -> Uuid,
        job_type -> Text,
        payload -> Jsonb,
        status -> Text,
        attempts -> Int4,
        run_after -> Timestamptz,
        last_error -> Nullable<Text>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        tenant_id -> Nullable<Uuid>,
        result -> Nullable<Jsonb>,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::MagicTokenKind;

    magic_tokens (id) {
        id -> Uuid,
        user_id -> Uuid,
        kind -> MagicTokenKind,
        token_hash -> Varchar,
        metadata -> Jsonb,
        expires_at -> Timestamptz,
        max_uses -> Nullable<Int4>,
        used_count -> Int4,
        created_at -> Timestamptz,
        created_by -> Nullable<Uuid>,
        last_used_at -> Nullable<Timestamptz>,
    }
}

diesel::table! {
    user_sessions (id) {
        id -> Uuid,
        user_id -> Uuid,
        token_hash -> Text,
        issued_at -> Timestamptz,
        expires_at -> Timestamptz,
        revoked_at -> Nullable<Timestamptz>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    tags (id) {
        id -> Uuid,
        #[max_length = 100]
        label -> Varchar,
        #[max_length = 7]
        color -> Nullable<Varchar>,
        created_at -> Timestamptz,
        tenant_id -> Uuid,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::TenantStatus;

    tenants (id) {
        id -> Uuid,
        name -> Text,
        storage_root -> Nullable<Text>,
        quickwit_index -> Nullable<Text>,
        config -> Jsonb,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        status -> TenantStatus,
        created_by -> Nullable<Uuid>,
    }
}

diesel::table! {
    user_memberships (id) {
        id -> Uuid,
        user_id -> Uuid,
        tenant_id -> Uuid,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        capability_set_id -> Nullable<Uuid>,
    }
}

diesel::table! {
    user_passkeys (id) {
        id -> Uuid,
        user_id -> Uuid,
        credential_id -> Bytea,
        public_key -> Bytea,
        credential -> Jsonb,
        sign_count -> Int8,
        transports -> Array<Nullable<Text>>,
        aaguid -> Nullable<Uuid>,
        nickname -> Nullable<Text>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        last_used_at -> Nullable<Timestamptz>,
        revoked_at -> Nullable<Timestamptz>,
        revoked_by -> Nullable<Uuid>,
        revoked_reason -> Nullable<Text>,
    }
}

diesel::table! {
    users (id) {
        id -> Uuid,
        #[max_length = 100]
        username -> Varchar,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    webauthn_challenges (id) {
        id -> Uuid,
        user_id -> Nullable<Uuid>,
        purpose -> Text,
        challenge -> Bytea,
        state -> Bytea,
        created_at -> Timestamptz,
        expires_at -> Timestamptz,
    }
}

diesel::table! {
    use diesel::sql_types::*;

    capability_sets (id) {
        id -> Uuid,
        tenant_id -> Uuid,
        slug -> Text,
        cap_version -> Int4,
        is_system -> Bool,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::ApiCapability;

    capability_set_capabilities (capability_set_id, capability) {
        capability_set_id -> Uuid,
        capability -> ApiCapability,
    }
}

diesel::table! {
    api_tokens (id) {
        id -> Uuid,
        user_id -> Uuid,
        tenant_id -> Uuid,
        token_prefix -> Text,
        token_hash -> Text,
        label -> Nullable<Text>,
        created_at -> Timestamptz,
        last_used_at -> Nullable<Timestamptz>,
        expires_at -> Nullable<Timestamptz>,
        revoked_at -> Nullable<Timestamptz>,
        capability_set_id -> Uuid,
    }
}

diesel::joinable!(correspondents -> tenants (tenant_id));
diesel::joinable!(capability_set_capabilities -> capability_sets (capability_set_id));
diesel::joinable!(capability_sets -> tenants (tenant_id));
diesel::joinable!(document_assets -> document_versions (document_version_id));
diesel::joinable!(document_assets -> tenants (tenant_id));
diesel::joinable!(document_correspondents -> correspondents (correspondent_id));
diesel::joinable!(document_correspondents -> documents (document_id));
diesel::joinable!(document_correspondents -> tenants (tenant_id));
diesel::joinable!(document_correspondents -> users (assigned_by));
diesel::joinable!(document_tags -> documents (document_id));
diesel::joinable!(document_tags -> tags (tag_id));
diesel::joinable!(document_tags -> tenants (tenant_id));
diesel::joinable!(document_tags -> users (assigned_by));
diesel::joinable!(document_versions -> tenants (tenant_id));
diesel::joinable!(documents -> folders (folder_id));
diesel::joinable!(documents -> tenants (tenant_id));
diesel::joinable!(folders -> tenants (tenant_id));
diesel::joinable!(jobs -> tenants (tenant_id));
diesel::joinable!(magic_tokens -> users (user_id));
diesel::joinable!(user_sessions -> tenants (tenant_id));
diesel::joinable!(user_sessions -> users (user_id));
diesel::joinable!(tags -> tenants (tenant_id));
diesel::joinable!(user_memberships -> capability_sets (capability_set_id));
diesel::joinable!(user_memberships -> tenants (tenant_id));
diesel::joinable!(user_memberships -> users (user_id));
diesel::joinable!(user_passkeys -> users (user_id));
diesel::joinable!(webauthn_challenges -> users (user_id));
diesel::joinable!(api_tokens -> tenants (tenant_id));
diesel::joinable!(api_tokens -> capability_sets (capability_set_id));
diesel::joinable!(api_tokens -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    api_tokens,
    correspondents,
    capability_set_capabilities,
    capability_sets,
    document_assets,
    document_correspondents,
    document_tags,
    document_versions,
    documents,
    folders,
    jobs,
    magic_tokens,
    user_sessions,
    tags,
    tenants,
    user_memberships,
    user_passkeys,
    users,
    webauthn_challenges,
);
