use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use diesel::prelude::*;
use diesel::OptionalExtension;
use diesel::PgConnection;
use futures_util::StreamExt;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use uuid::Uuid;

use crate::auth::{
    api_tokens::{find_active_token_by_secret, touch_api_token},
    ensure_active_tenant_with_conn,
};
use crate::error::{AppError, AppResult};
use crate::models::{ApiCapability, Document, DocumentVersion, Folder, User};
use crate::schema::{
    document_versions::dsl as document_versions_dsl, documents::dsl as documents_dsl,
    folders::dsl as folders_dsl, user_memberships::dsl as memberships_dsl, users::dsl as users_dsl,
};
use crate::state::{AppState, PgPooledConnection};
use crate::tenants::{apply_tenant_guc, apply_user_guc, clear_user_guc};
use crate::utils::{error::StorageResultExt, http::inline_content_disposition, time::to_http_date};

const REALM: &str = "Papercrate WebDAV";
const DOWNLOAD_URL_TTL_SECONDS: u64 = 300;

struct WebDavContext {
    tenant_id: Uuid,
    _user_id: Uuid,
    _username: String,
    conn: PgPooledConnection,
}

pub fn create_router() -> Router<AppState> {
    Router::new().fallback(webdav_entrypoint)
}

async fn webdav_entrypoint(
    State(state): State<AppState>,
    req: axum::http::Request<axum::body::Body>,
) -> Result<Response, AppError> {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let path = req.uri().path().trim_start_matches('/').to_string();

    tracing::debug!(method = %method, %path, "webdav entrypoint" );

    match method {
        ref m if m == Method::OPTIONS => Ok(handle_options()),
        ref m if m == Method::GET => handle_get_or_head(&state, &path, headers, Method::GET).await,
        ref m if m == Method::HEAD => {
            handle_get_or_head(&state, &path, headers, Method::HEAD).await
        }
        _ => {
            if method.as_str() == "PROPFIND" {
                handle_propfind(&state, &path, headers).await
            } else {
                Ok(method_not_allowed())
            }
        }
    }
}

async fn handle_propfind(
    state: &AppState,
    path: &str,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let mut context = match authenticate(state, &headers)? {
        Some(user) => user,
        None => return Ok(unauthorized_response()),
    };

    let depth = match parse_depth(&headers) {
        Ok(value) => value,
        Err(response) => return Ok(response),
    };

    let segments = parse_segments(path)?;

    let tenant_id = context.tenant_id;

    let resources = if segments.is_empty() {
        let contents = fetch_folder_contents(&mut context.conn, tenant_id, None)?;
        build_resources_for_folder(None, &[], &contents, depth)
    } else {
        let resolution = match resolve_path(&mut context.conn, tenant_id, &segments)? {
            Some(resolved) => resolved,
            None => return Ok(not_found_response()),
        };

        match resolution {
            ResolvedPath::Folder { folder, chain } => {
                let contents =
                    fetch_folder_contents(&mut context.conn, tenant_id, Some(folder.id))?;
                build_resources_for_folder(Some(&folder), &chain, &contents, depth)
            }
            ResolvedPath::Document {
                document,
                version,
                chain,
            } => build_resources_for_document(&chain, &document, &version),
        }
    };

    let body = render_multistatus(&resources).map_err(|err| {
        tracing::error!(error = ?err, "failed to render WebDAV response");
        AppError::internal("failed to render WebDAV response")
    })?;

    let response = Response::builder()
        .status(multi_status())
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(body))
        .expect("valid response");

    Ok(response)
}

async fn handle_get_or_head(
    state: &AppState,
    path: &str,
    headers: HeaderMap,
    method: Method,
) -> Result<Response, AppError> {
    let mut context = match authenticate(state, &headers)? {
        Some(user) => user,
        None => return Ok(unauthorized_response()),
    };

    let tenant_id = context.tenant_id;
    let segments = parse_segments(path)?;
    if segments.is_empty() {
        return Ok(method_not_allowed());
    }

    let resolution = match resolve_path(&mut context.conn, tenant_id, &segments)? {
        Some(resolved) => resolved,
        None => return Ok(not_found_response()),
    };

    let (document, version, chain) = match resolution {
        ResolvedPath::Document {
            document,
            version,
            chain,
        } => (document, version, chain),
        _ => return Ok(method_not_allowed()),
    };

    stream_document(state, &document, &version, &chain, headers, method).await
}

fn handle_options() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header("DAV", "1,2")
        .header(header::ALLOW, "OPTIONS, PROPFIND, GET, HEAD")
        .header("Accept-Ranges", "bytes")
        .body(Body::empty())
        .expect("valid OPTIONS response")
}

fn method_not_allowed() -> Response {
    Response::builder()
        .status(StatusCode::METHOD_NOT_ALLOWED)
        .body(Body::empty())
        .expect("valid response")
}

fn not_found_response() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::empty())
        .expect("valid response")
}

fn unauthorized_response() -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(
            header::WWW_AUTHENTICATE,
            format!("Basic realm=\"{REALM}\", charset=\"UTF-8\""),
        )
        .body(Body::empty())
        .expect("valid response")
}

fn multi_status() -> StatusCode {
    StatusCode::from_u16(207).expect("valid multi-status")
}

fn parse_depth(headers: &HeaderMap) -> Result<u8, Response> {
    match headers.get("Depth") {
        None => Ok(1),
        Some(value) => match value.to_str() {
            Ok("0") => Ok(0),
            Ok("1") => Ok(1),
            Ok("infinity") => Err(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::empty())
                .expect("valid response")),
            _ => Err(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::empty())
                .expect("valid response")),
        },
    }
}

fn parse_segments(path: &str) -> AppResult<Vec<String>> {
    if path.trim_matches('/').is_empty() {
        return Ok(vec![]);
    }

    let segments = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            percent_decode_str(segment)
                .decode_utf8()
                .map(|cow| cow.into_owned())
                .map_err(|_| AppError::bad_request("invalid UTF-8 in path"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(segments)
}

fn fetch_folder_contents(
    conn: &mut PgPooledConnection,
    tenant_id: Uuid,
    folder_id: Option<Uuid>,
) -> AppResult<WebDavFolderContents> {
    let folder = match folder_id {
        Some(id) => Some(
            folders_dsl::folders
                .filter(folders_dsl::tenant_id.eq(tenant_id))
                .find(id)
                .first::<Folder>(conn)?,
        ),
        None => None,
    };

    let subfolders: Vec<Folder> = match folder_id {
        Some(id) => folders_dsl::folders
            .filter(folders_dsl::tenant_id.eq(tenant_id))
            .filter(folders_dsl::parent_id.eq(Some(id)))
            .order(folders_dsl::name.asc())
            .load(conn)?,
        None => folders_dsl::folders
            .filter(folders_dsl::tenant_id.eq(tenant_id))
            .filter(folders_dsl::parent_id.is_null())
            .order(folders_dsl::name.asc())
            .load(conn)?,
    };

    let mut docs_query = documents_dsl::documents
        .filter(documents_dsl::deleted_at.is_null())
        .filter(documents_dsl::tenant_id.eq(tenant_id))
        .into_boxed();

    docs_query = match folder_id {
        Some(id) => docs_query.filter(documents_dsl::folder_id.eq(Some(id))),
        None => docs_query.filter(documents_dsl::folder_id.is_null()),
    };

    let documents: Vec<Document> = docs_query
        .order(documents_dsl::created_at.desc())
        .load(conn)?;

    let version_ids: Vec<Uuid> = documents.iter().map(|doc| doc.current_version_id).collect();
    let versions: Vec<DocumentVersion> = if version_ids.is_empty() {
        Vec::new()
    } else {
        document_versions_dsl::document_versions
            .filter(document_versions_dsl::id.eq_any(&version_ids))
            .load(conn)?
    };

    let mut version_map = versions
        .into_iter()
        .map(|version| (version.id, version))
        .collect::<std::collections::HashMap<_, _>>();

    let mut entries = Vec::with_capacity(documents.len());
    for document in documents {
        if let Some(version) = version_map.remove(&document.current_version_id) {
            entries.push(DocumentEntry { document, version });
        }
    }

    Ok(WebDavFolderContents {
        _folder: folder,
        subfolders,
        documents: entries,
    })
}

async fn stream_document(
    state: &AppState,
    document: &Document,
    version: &DocumentVersion,
    _chain: &[String],
    headers: HeaderMap,
    method: Method,
) -> Result<Response, AppError> {
    let range_header = headers.get(header::RANGE).cloned();

    let storage = state.storage_for_tenant(document.tenant_id)?;

    let url = storage
        .presign_get_object(
            &version.s3_key,
            Duration::from_secs(DOWNLOAD_URL_TTL_SECONDS),
            None,
        )
        .await
        .storage_context("failed to presign document download")?;

    let client = reqwest::Client::new();
    let mut request = client.request(method.clone(), url.clone());

    if let Some(range) = range_header.clone() {
        request = request.header(header::RANGE, range.clone());
    }

    let upstream = request.send().await.map_err(|err| {
        tracing::error!(error = ?err, "failed to fetch document stream");
        AppError::internal("failed to fetch document stream")
    })?;

    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    if !(status.is_success() || status == StatusCode::PARTIAL_CONTENT) {
        tracing::error!(status = %status, "upstream download returned error status");
        return Err(AppError::internal("failed to fetch document stream"));
    }

    let mut builder = Response::builder().status(status);

    if let Some(content_type) = upstream.headers().get(header::CONTENT_TYPE) {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    } else if let Some(ref typ) = document.mime_type {
        builder = builder.header(header::CONTENT_TYPE, typ);
    }

    if let Some(content_length) = upstream.headers().get(header::CONTENT_LENGTH) {
        builder = builder.header(header::CONTENT_LENGTH, content_length);
    }

    if let Some(range) = upstream.headers().get(header::CONTENT_RANGE) {
        builder = builder.header(header::CONTENT_RANGE, range);
    }

    builder = builder.header("Accept-Ranges", "bytes");

    if let Some(disposition) = inline_content_disposition(&document.filename) {
        builder = builder.header(header::CONTENT_DISPOSITION, disposition);
    }

    builder = builder.header(header::ETAG, format!("\"{}\"", version.id));

    if method == Method::HEAD {
        return builder.body(Body::empty()).map_err(|err| {
            tracing::error!(error = ?err, "failed to build WebDAV response");
            AppError::internal("failed to build WebDAV response")
        });
    }

    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err)));
    let body = Body::from_stream(stream);

    builder.body(body).map_err(|err| {
        tracing::error!(error = ?err, "failed to build WebDAV response");
        AppError::internal("failed to build WebDAV response")
    })
}

fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<Option<WebDavContext>, AppError> {
    tracing::debug!("webdav authenticate invoked");
    let authorization = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(header) if header.starts_with("Basic ") => {
                tracing::debug!("authorization header present");
                &header[6..]
            }
            Ok(other) => {
                tracing::warn!(header = %other, "non-basic authorization header");
                return Ok(None);
            }
            Err(err) => {
                tracing::warn!(error = %err, "invalid authorization header");
                return Ok(None);
            }
        },
        None => {
            tracing::debug!("no authorization header");
            return Ok(None);
        }
    };

    let decoded = match BASE64.decode(authorization) {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::warn!(error = %err, "failed to decode basic credentials");
            return Ok(None);
        }
    };

    let credential_str = match String::from_utf8(decoded) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(error = %err, "invalid utf-8 basic credentials");
            return Ok(None);
        }
    };

    let (presented_username, secret) = match credential_str.split_once(':') {
        Some((username, secret)) if !username.is_empty() => (username, secret),
        _ => return Ok(None),
    };

    tracing::debug!(presented_username = %presented_username, "attempting webdav login");
    let mut conn = state.db_unscoped()?;

    let token = match find_active_token_by_secret(
        &mut conn,
        None,
        secret,
        Some(ApiCapability::WebdavRead),
    )? {
        Some(token) => token,
        None => {
            tracing::warn!(presented_username = %presented_username, "webdav token invalid or expired");
            return Ok(None);
        }
    };

    let user: User = match users_dsl::users.find(token.user_id).first(&mut conn) {
        Ok(user) => user,
        Err(diesel::result::Error::NotFound) => {
            tracing::warn!(
                presented_username = %presented_username,
                user_id = %token.user_id,
                "webdav token user missing"
            );
            return Ok(None);
        }
        Err(err) => return Err(AppError::from(err)),
    };

    apply_user_guc(&mut conn, user.id)?;

    let membership_exists = memberships_dsl::user_memberships
        .filter(memberships_dsl::user_id.eq(user.id))
        .filter(memberships_dsl::tenant_id.eq(token.tenant_id))
        .select(memberships_dsl::tenant_id)
        .first::<Uuid>(&mut conn)
        .optional()?;

    clear_user_guc(&mut conn)?;

    let tenant_id = match membership_exists {
        Some(id) => id,
        None => {
            tracing::warn!(
                presented_username = %presented_username,
                username = %user.username,
                tenant_id = %token.tenant_id,
                "webdav token tenant membership missing"
            );
            return Ok(None);
        }
    };

    if let Err(err) = ensure_active_tenant_with_conn(&mut conn, tenant_id) {
        tracing::warn!(tenant_id = %tenant_id, error = ?err, "webdav tenant not active");
        return Ok(None);
    }

    apply_tenant_guc(&mut conn, tenant_id)?;
    touch_api_token(&mut conn, token.id)?;

    tracing::debug!(
        presented_username = %presented_username,
        username = %user.username,
        tenant_id = %tenant_id,
        token_id = %token.id,
        "webdav token login success"
    );
    Ok(Some(WebDavContext {
        tenant_id,
        _user_id: user.id,
        _username: user.username,
        conn,
    }))
}

fn build_resources_for_folder(
    folder: Option<&Folder>,
    chain: &[String],
    contents: &WebDavFolderContents,
    depth: u8,
) -> Vec<DavResource> {
    let mut resources = Vec::new();

    let display_name = folder
        .map(|folder| folder.name.clone())
        .unwrap_or_else(|| chain.last().cloned().unwrap_or_else(|| "/".to_string()));

    let href = build_href(chain, true);
    let last_modified = folder.map(|folder| to_http_date(folder.updated_at));

    resources.push(DavResource {
        href,
        display_name,
        is_collection: true,
        content_length: None,
        mime_type: None,
        last_modified,
    });

    if depth == 0 {
        return resources;
    }

    for subfolder in &contents.subfolders {
        let mut child_chain = chain.to_vec();
        child_chain.push(subfolder.name.clone());
        resources.push(DavResource {
            href: build_href(&child_chain, true),
            display_name: subfolder.name.clone(),
            is_collection: true,
            content_length: None,
            mime_type: None,
            last_modified: Some(to_http_date(subfolder.updated_at)),
        });
    }

    for entry in &contents.documents {
        let mut child_chain = chain.to_vec();
        child_chain.push(entry.document.filename.clone());
        resources.push(document_to_resource(
            &child_chain,
            &entry.document,
            &entry.version,
        ));
    }

    resources
}

fn build_resources_for_document(
    chain: &[String],
    document: &Document,
    version: &DocumentVersion,
) -> Vec<DavResource> {
    vec![document_to_resource(chain, document, version)]
}

fn document_to_resource(
    chain: &[String],
    document: &Document,
    version: &DocumentVersion,
) -> DavResource {
    let href = build_href(chain, false);

    DavResource {
        href,
        display_name: document.title.clone(),
        is_collection: false,
        content_length: Some(version.size_bytes),
        mime_type: document.mime_type.clone(),
        last_modified: Some(to_http_date(document.updated_at)),
    }
}

fn build_href(names: &[String], is_collection: bool) -> String {
    if names.is_empty() {
        return "/".to_string();
    }

    let encoded = names
        .iter()
        .map(|name| utf8_percent_encode(name, NON_ALPHANUMERIC).to_string())
        .collect::<Vec<_>>();

    let mut path = format!("/{}", encoded.join("/"));
    if is_collection && !path.ends_with('/') {
        path.push('/');
    }
    path
}

fn render_multistatus(resources: &[DavResource]) -> Result<Vec<u8>, quick_xml::Error> {
    let mut writer = Writer::new(Vec::new());
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

    let mut multistatus = BytesStart::new("D:multistatus");
    multistatus.push_attribute(("xmlns:D", "DAV:"));
    writer.write_event(Event::Start(multistatus))?;

    for resource in resources {
        writer.write_event(Event::Start(BytesStart::new("D:response")))?;

        writer.write_event(Event::Start(BytesStart::new("D:href")))?;
        writer.write_event(Event::Text(BytesText::new(&resource.href)))?;
        writer.write_event(Event::End(BytesEnd::new("D:href")))?;

        writer.write_event(Event::Start(BytesStart::new("D:propstat")))?;
        writer.write_event(Event::Start(BytesStart::new("D:prop")))?;

        writer.write_event(Event::Start(BytesStart::new("D:displayname")))?;
        writer.write_event(Event::Text(BytesText::new(&resource.display_name)))?;
        writer.write_event(Event::End(BytesEnd::new("D:displayname")))?;

        writer.write_event(Event::Start(BytesStart::new("D:resourcetype")))?;
        if resource.is_collection {
            writer.write_event(Event::Empty(BytesStart::new("D:collection")))?;
        }
        writer.write_event(Event::End(BytesEnd::new("D:resourcetype")))?;

        if let Some(length) = resource.content_length {
            writer.write_event(Event::Start(BytesStart::new("D:getcontentlength")))?;
            writer.write_event(Event::Text(BytesText::new(&length.to_string())))?;
            writer.write_event(Event::End(BytesEnd::new("D:getcontentlength")))?;
        }

        if let Some(content_type) = &resource.mime_type {
            writer.write_event(Event::Start(BytesStart::new("D:getcontenttype")))?;
            writer.write_event(Event::Text(BytesText::new(content_type)))?;
            writer.write_event(Event::End(BytesEnd::new("D:getcontenttype")))?;
        }

        if let Some(last_modified) = &resource.last_modified {
            writer.write_event(Event::Start(BytesStart::new("D:getlastmodified")))?;
            writer.write_event(Event::Text(BytesText::new(last_modified)))?;
            writer.write_event(Event::End(BytesEnd::new("D:getlastmodified")))?;
        }

        writer.write_event(Event::End(BytesEnd::new("D:prop")))?;

        writer.write_event(Event::Start(BytesStart::new("D:status")))?;
        writer.write_event(Event::Text(BytesText::new("HTTP/1.1 200 OK")))?;
        writer.write_event(Event::End(BytesEnd::new("D:status")))?;

        writer.write_event(Event::End(BytesEnd::new("D:propstat")))?;
        writer.write_event(Event::End(BytesEnd::new("D:response")))?;
    }

    writer.write_event(Event::End(BytesEnd::new("D:multistatus")))?;
    Ok(writer.into_inner())
}

struct WebDavFolderContents {
    _folder: Option<Folder>,
    subfolders: Vec<Folder>,
    documents: Vec<DocumentEntry>,
}

struct DocumentEntry {
    document: Document,
    version: DocumentVersion,
}

struct DavResource {
    href: String,
    display_name: String,
    is_collection: bool,
    content_length: Option<i64>,
    mime_type: Option<String>,
    last_modified: Option<String>,
}
enum ResolvedPath {
    Folder {
        folder: Folder,
        chain: Vec<String>,
    },
    Document {
        document: Document,
        version: DocumentVersion,
        chain: Vec<String>,
    },
}

fn resolve_path(
    conn: &mut PgPooledConnection,
    tenant_id: Uuid,
    segments: &[String],
) -> AppResult<Option<ResolvedPath>> {
    let mut parent_id: Option<Uuid> = None;
    let mut chain: Vec<String> = Vec::new();
    let mut current_folder: Option<Folder> = None;

    for (index, segment) in segments.iter().enumerate() {
        let is_last = index == segments.len() - 1;

        if let Some(folder) = find_folder_by_name(conn, tenant_id, parent_id, segment)? {
            chain.push(folder.name.clone());
            if is_last {
                return Ok(Some(ResolvedPath::Folder { folder, chain }));
            }
            parent_id = Some(folder.id);
            current_folder = Some(folder);
            continue;
        }

        if is_last {
            if let Some((document, version)) =
                find_document_by_filename(conn, tenant_id, parent_id, segment)?
            {
                chain.push(document.filename.clone());
                return Ok(Some(ResolvedPath::Document {
                    document,
                    version,
                    chain,
                }));
            }
        }

        if let Ok(uuid) = Uuid::parse_str(segment) {
            if let Some(folder) = find_folder_by_id(conn, tenant_id, uuid)? {
                if folder.parent_id != parent_id {
                    return Ok(None);
                }
                chain.push(folder.name.clone());
                if is_last {
                    return Ok(Some(ResolvedPath::Folder { folder, chain }));
                }
                parent_id = Some(folder.id);
                current_folder = Some(folder);
                continue;
            }

            if let Some((document, version)) = find_document_by_id(conn, tenant_id, uuid)? {
                if document.folder_id != parent_id {
                    return Ok(None);
                }
                chain.push(document.filename.clone());
                return Ok(Some(ResolvedPath::Document {
                    document,
                    version,
                    chain,
                }));
            }
        }

        return Ok(None);
    }

    Ok(current_folder.map(|folder| ResolvedPath::Folder { folder, chain }))
}

fn find_folder_by_name(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    parent_id: Option<Uuid>,
    name: &str,
) -> AppResult<Option<Folder>> {
    let mut query = folders_dsl::folders
        .filter(folders_dsl::tenant_id.eq(tenant_id))
        .into_boxed();

    query = match parent_id {
        Some(parent) => query.filter(folders_dsl::parent_id.eq(Some(parent))),
        None => query.filter(folders_dsl::parent_id.is_null()),
    };

    Ok(query
        .filter(folders_dsl::name.eq(name))
        .first::<Folder>(conn)
        .optional()?)
}

fn find_folder_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    folder_id: Uuid,
) -> AppResult<Option<Folder>> {
    Ok(folders_dsl::folders
        .filter(folders_dsl::tenant_id.eq(tenant_id))
        .find(folder_id)
        .first::<Folder>(conn)
        .optional()?)
}

fn find_document_by_filename(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    parent_id: Option<Uuid>,
    filename: &str,
) -> AppResult<Option<(Document, DocumentVersion)>> {
    let mut query = documents_dsl::documents
        .filter(documents_dsl::deleted_at.is_null())
        .filter(documents_dsl::tenant_id.eq(tenant_id))
        .filter(documents_dsl::filename.eq(filename))
        .into_boxed();

    query = match parent_id {
        Some(parent) => query.filter(documents_dsl::folder_id.eq(Some(parent))),
        None => query.filter(documents_dsl::folder_id.is_null()),
    };

    if let Some(document) = query.first::<Document>(conn).optional()? {
        let version = document_versions_dsl::document_versions
            .find(document.current_version_id)
            .first::<DocumentVersion>(conn)?;
        return Ok(Some((document, version)));
    }

    Ok(None)
}

fn find_document_by_id(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    document_id: Uuid,
) -> AppResult<Option<(Document, DocumentVersion)>> {
    if let Some(document) = documents_dsl::documents
        .filter(documents_dsl::deleted_at.is_null())
        .filter(documents_dsl::tenant_id.eq(tenant_id))
        .find(document_id)
        .first::<Document>(conn)
        .optional()?
    {
        let version = document_versions_dsl::document_versions
            .find(document.current_version_id)
            .first::<DocumentVersion>(conn)?;
        return Ok(Some((document, version)));
    }

    Ok(None)
}
