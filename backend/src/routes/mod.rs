use axum::http::HeaderValue;
use axum::{
    extract::DefaultBodyLimit,
    middleware,
    response::{Html, Json},
    routing::{delete, get, patch, post},
    Router,
};
use std::sync::Arc;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnFailure, DefaultOnResponse, TraceLayer},
};
use utoipa::OpenApi;

use crate::{
    auth::{capability_guard::RequireCapabilitiesLayer, AuthenticatedUser},
    models::ApiCapability,
    openapi::ApiDoc,
    state::AppState,
};

pub mod auth;
pub mod capability_sets;
pub mod correspondents;
pub mod documents;
pub mod folders;
pub mod health;
pub mod profile;
pub mod tags;
pub mod tenants;
pub mod webdav;

pub fn create_router(state: AppState) -> Router<()> {
    let cors = if let Some(origins) = state.config.cors_allowed_origin.as_ref() {
        let headers: Vec<HeaderValue> = origins
            .split(',')
            .filter_map(|value| {
                let trimmed = value.trim();
                (!trimmed.is_empty()).then(|| {
                    trimmed
                        .parse::<HeaderValue>()
                        .expect("invalid CORS allowed origin")
                })
            })
            .collect();

        let allow_origin = AllowOrigin::list(headers);

        CorsLayer::new()
            .allow_origin(allow_origin)
            .allow_methods(tower_http::cors::AllowMethods::mirror_request())
            .allow_headers(tower_http::cors::AllowHeaders::mirror_request())
            .allow_credentials(true)
    } else {
        CorsLayer::new()
            .allow_origin(AllowOrigin::mirror_request())
            .allow_methods(tower_http::cors::AllowMethods::mirror_request())
            .allow_headers(tower_http::cors::AllowHeaders::mirror_request())
            .allow_credentials(true)
    };

    let auth_routes = Router::new()
        .route("/signup/start", post(auth::signup_start))
        .route("/signup/finish", post(auth::signup_finish))
        .route("/login", post(auth::login))
        .route("/exchange-api-token", post(auth::api_token_exchange))
        .route("/refresh", post(auth::refresh))
        .route("/logout", post(auth::logout))
        .route("/select-tenant", post(auth::select_tenant))
        .route(
            "/passkeys/register/start",
            post(auth::passkey_register_start),
        )
        .route(
            "/passkeys/register/finish",
            post(auth::passkey_register_finish),
        )
        .route("/passkeys/login/start", post(auth::passkey_login_start))
        .route("/passkeys/login/finish", post(auth::passkey_login_finish))
        .route("/me", get(auth::me));

    let documents_routes = Router::new()
        .route(
            "/check",
            get(documents::check_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/",
            get(documents::list_documents).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/",
            post(documents::upload_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsWrite,
                ApiCapability::DocumentsUpload,
            ])),
        )
        .route(
            "/bulk/move",
            post(documents::bulk_move_documents).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/bulk/tags",
            post(documents::bulk_update_tags).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/bulk/correspondents",
            post(documents::bulk_assign_correspondents).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/bulk/reanalyze",
            post(documents::reanalyze_selected_documents).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsWrite,
            ])),
        )
        .route(
            "/{id}",
            get(documents::get_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/{id}/download",
            post(documents::refresh_document_download).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/{id}/trash",
            post(documents::trash_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsWrite,
            ])),
        )
        .route(
            "/{id}",
            delete(documents::delete_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsWrite,
            ])),
        )
        .route(
            "/{id}",
            patch(documents::update_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/{id}/assets",
            get(documents::list_document_assets).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/{id}/assets",
            post(documents::request_document_assets).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsWrite,
            ])),
        )
        .route(
            "/{id}/folder",
            patch(documents::move_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/{id}/versions",
            get(documents::list_document_versions).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/{id}/versions/{version_id}",
            get(documents::get_document_version).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/{id}/versions/{version_id}/download",
            post(documents::refresh_document_version_download).layer(
                RequireCapabilitiesLayer::all([ApiCapability::DocumentsRead]),
            ),
        )
        .route(
            "/{id}/restore",
            post(documents::restore_document).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/{id}/tags",
            post(documents::assign_tags).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/{id}/tags/{tag_id}",
            delete(documents::remove_tag).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/{id}/correspondents",
            post(documents::assign_correspondents).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        )
        .route(
            "/{id}/correspondents/{correspondent_id}",
            delete(documents::remove_correspondent).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsEdit,
            ])),
        );

    let download_routes =
        Router::new().route("/api/download/{token}", get(documents::download_with_token));

    let folders_routes = Router::new()
        .route(
            "/",
            post(folders::create_folder)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersWrite])),
        )
        .route(
            "/path",
            post(folders::ensure_folder_path)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersWrite])),
        )
        .route(
            "/tree",
            get(folders::list_folder_tree)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersRead])),
        )
        .route(
            "/{id}",
            get(folders::get_folder)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersRead])),
        )
        .route(
            "/{id}",
            delete(folders::delete_folder)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersWrite])),
        )
        .route(
            "/{id}",
            patch(folders::update_folder)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersEdit])),
        )
        .route(
            "/{id}/contents",
            get(folders::list_folder_contents)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::FoldersRead])),
        );

    let tags_routes = Router::new()
        .route(
            "/",
            get(tags::list_tags).layer(RequireCapabilitiesLayer::all([ApiCapability::TagsRead])),
        )
        .route(
            "/",
            post(tags::create_tag).layer(RequireCapabilitiesLayer::all([ApiCapability::TagsWrite])),
        )
        .route(
            "/{id}",
            patch(tags::update_tag).layer(RequireCapabilitiesLayer::all([ApiCapability::TagsEdit])),
        )
        .route(
            "/{id}",
            delete(tags::delete_tag)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::TagsWrite])),
        );

    let correspondents_routes = Router::new()
        .route(
            "/",
            get(correspondents::list_correspondents).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CorrespondentsRead,
            ])),
        )
        .route(
            "/",
            post(correspondents::create_correspondent).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CorrespondentsWrite,
            ])),
        )
        .route(
            "/{id}",
            patch(correspondents::update_correspondent).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CorrespondentsEdit,
            ])),
        )
        .route(
            "/{id}",
            delete(correspondents::delete_correspondent).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CorrespondentsWrite,
            ])),
        );

    let profile_routes = Router::new()
        .route(
            "/api-tokens",
            get(profile::list_api_tokens)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::ProfileRead])),
        )
        .route(
            "/api-tokens",
            post(profile::create_api_token)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::ProfileWrite])),
        )
        .route(
            "/api-tokens/{id}/regenerate",
            post(profile::regenerate_api_token)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::ProfileWrite])),
        )
        .route(
            "/api-tokens/{id}",
            delete(profile::delete_api_token)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::ProfileWrite])),
        )
        .route(
            "/passkeys",
            get(profile::list_passkeys)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::ProfileRead])),
        )
        .route(
            "/passkeys/{id}",
            delete(profile::delete_passkey)
                .layer(RequireCapabilitiesLayer::all([ApiCapability::ProfileWrite])),
        );

    let capability_sets_routes = Router::new()
        .route(
            "/",
            get(capability_sets::list_capability_sets).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CapabilitySetsRead,
            ])),
        )
        .route(
            "/",
            post(capability_sets::create_capability_set).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CapabilitySetsWrite,
            ])),
        )
        .route(
            "/{id}",
            get(capability_sets::get_capability_set).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CapabilitySetsRead,
            ])),
        )
        .route(
            "/{id}",
            patch(capability_sets::update_capability_set).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CapabilitySetsWrite,
            ])),
        )
        .route(
            "/{id}",
            delete(capability_sets::delete_capability_set).layer(RequireCapabilitiesLayer::all([
                ApiCapability::CapabilitySetsWrite,
            ])),
        );

    let capabilities_routes = Router::new().route(
        "/",
        get(capability_sets::list_capabilities).layer(RequireCapabilitiesLayer::all([
            ApiCapability::CapabilitySetsRead,
        ])),
    );

    let protected_state = state.clone();
    let assets_routes = Router::new()
        .route(
            "/{asset_id}",
            get(documents::get_document_asset).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        )
        .route(
            "/{asset_id}/download",
            post(documents::refresh_asset_download).layer(RequireCapabilitiesLayer::all([
                ApiCapability::DocumentsRead,
            ])),
        );

    let manage_tenants_layer = RequireCapabilitiesLayer::all([ApiCapability::TenantsWrite]);
    let tenants_routes = Router::new()
        .route("/", get(tenants::list_tenants))
        .route("/{tenant_id}", get(tenants::get_tenant))
        .route(
            "/{tenant_id}",
            patch(tenants::update_tenant).layer(manage_tenants_layer.clone()),
        )
        .route(
            "/{tenant_id}/users",
            get(tenants::list_tenant_users).layer(manage_tenants_layer.clone()),
        )
        .route(
            "/{tenant_id}/users/{user_id}",
            get(tenants::get_tenant_user).layer(manage_tenants_layer.clone()),
        )
        .route(
            "/{tenant_id}/users/{user_id}",
            patch(tenants::update_tenant_user).layer(manage_tenants_layer.clone()),
        )
        .route(
            "/{tenant_id}/users/{user_id}",
            delete(tenants::delete_tenant_user).layer(manage_tenants_layer.clone()),
        );

    let protected_routes = Router::new()
        .nest("/api/documents", documents_routes)
        .nest("/api/folders", folders_routes)
        .nest("/api/tags", tags_routes)
        .nest("/api/correspondents", correspondents_routes)
        .nest("/api/profile", profile_routes)
        .nest("/api/capability-sets", capability_sets_routes)
        .nest("/api/capabilities", capabilities_routes)
        .nest("/api/assets", assets_routes)
        .nest("/api/tenants", tenants_routes)
        .layer(middleware::from_extractor_with_state::<AuthenticatedUser, _>(protected_state));

    let upload_limit = state.config.upload_body_limit_bytes;

    let openapi_spec = Arc::new(ApiDoc::openapi());
    let docs_router = Router::new()
        .route(
            "/api/docs",
            get(move || async { Html(render_swagger_ui("/api/docs/openapi.json")) }),
        )
        .route(
            "/api/docs/openapi.json",
            get({
                let spec = openapi_spec.clone();
                move || async move { Json((*spec).clone()) }
            }),
        );

    Router::new()
        .merge(download_routes)
        .merge(protected_routes)
        .merge(docs_router)
        .nest("/api/auth", auth_routes)
        .route("/api/health", get(health::health_check))
        .with_state(state)
        .layer(cors)
        .layer(DefaultBodyLimit::max(
            usize::try_from(upload_limit).unwrap_or(usize::MAX),
        ))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(tracing::Level::INFO))
                .on_response(DefaultOnResponse::new().level(tracing::Level::INFO))
                .on_failure(DefaultOnFailure::new().level(tracing::Level::ERROR)),
        )
}

fn render_swagger_ui(spec_url: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Papercrate API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html {{ box-sizing: border-box; font-family: sans-serif; }}
      *, *:before, *:after {{ box-sizing: inherit; }}
      body {{ margin: 0; background: #fafafa; }}
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener('load', () => {{
        window.ui = SwaggerUIBundle({{
          url: '{spec_url}',
          dom_id: '#swagger-ui',
          deepLinking: true,
        }});
      }});
    </script>
  </body>
</html>"#
    )
}
