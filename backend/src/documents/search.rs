use std::collections::HashSet;

use anyhow::{anyhow, bail, Result};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{debug, error};
use uuid::Uuid;

use crate::models::{Document, DocumentVersion};

pub const QUICKWIT_MAX_HITS: usize = 200;

pub fn build_quickwit_query(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| {
            let normalized = token.to_lowercase();
            escape_quickwit_token(&normalized)
        })
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let parts: Vec<String> = tokens
        .into_iter()
        .map(|token| format!("(title:{token} OR text:{token})"))
        .collect();

    Some(parts.join(" AND "))
}

pub fn escape_quickwit_token(token: &str) -> String {
    let mut escaped = String::with_capacity(token.len());
    for ch in token.chars() {
        match ch {
            '+' | '-' | '&' | '|' | '!' | '(' | ')' | '{' | '}' | '[' | ']' | '^' | '"' | '~'
            | '*' | '?' | ':' | '\\' | '/' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }
    escaped
}

pub async fn quickwit_search(
    endpoint: &str,
    index: &str,
    tenant_id: Uuid,
    query: &str,
) -> Result<Vec<Uuid>> {
    let tenant_clause = format!("tenant_id:{}", tenant_id);
    let quickwit_query = match build_quickwit_query(query) {
        Some(q) => {
            debug!(%query, quickwit_query = %q, "built quickwit search query");
            format!("{} AND ({})", tenant_clause, q)
        }
        None => {
            debug!(%query, "quickwit search skipped because query produced no tokens");
            return Ok(vec![]);
        }
    };

    let client = Client::new();
    let url = format!("{}/api/v1/{}/search", endpoint.trim_end_matches('/'), index);

    let payload = json!({
        "query": quickwit_query,
        "max_hits": QUICKWIT_MAX_HITS,
    });

    debug!(%url, payload = %payload, "sending quickwit search request");
    let response = client.post(url).json(&payload).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!(%status, body = %body, "quickwit search request failed");
        return Err(anyhow!(
            "quickwit search failed with status {status}: {body}"
        ));
    }

    let data: QuickwitSearchResponse = response.json().await?;
    debug!("quickwit search response parsed successfully");
    let QuickwitSearchResponse { hits } = data;

    let total_hits = hits.len();
    let mut seen = HashSet::new();
    let mut doc_ids = Vec::with_capacity(total_hits);

    for hit in hits {
        if let Some(doc_id) = extract_document_id(&hit) {
            if seen.insert(doc_id) {
                doc_ids.push(doc_id);
            }
        }
    }

    debug!(
        total_hits = total_hits,
        unique_ids = doc_ids.len(),
        "quickwit search completed"
    );
    Ok(doc_ids)
}

pub fn quickwit_index_template(index_id: &str) -> Value {
    json!({
        "version": "0.8",
        "index_id": index_id,
        "doc_mapping": {
            "tokenizers": [
                {
                    "name": "substring",
                    "type": "ngram",
                    "min_gram": 2,
                    "max_gram": 20,
                    "prefix_only": false
                }
            ],
            "field_mappings": [
                { "name": "tenant_id", "type": "text", "stored": true },
                { "name": "document_id", "type": "text", "stored": true },
                { "name": "version_id", "type": "text", "stored": true },
                { "name": "title", "type": "text", "tokenizer": "substring", "stored": true },
                { "name": "text", "type": "text", "tokenizer": "substring", "record": "position" }
            ]
        },
        "search_settings": {
            "default_search_fields": ["title", "text"]
        }
    })
}

pub async fn ensure_quickwit_index(client: &Client, endpoint: &str, index_id: &str) -> Result<()> {
    let base = endpoint.trim_end_matches('/');
    let create_url = format!("{}/api/v1/indexes", base);
    let payload = quickwit_index_template(index_id);

    let response = client.post(&create_url).json(&payload).send().await?;
    match response.status() {
        status if status.is_success() => Ok(()),
        StatusCode::CONFLICT => {
            let lookup_url = format!("{}/api/v1/indexes/{}", base, index_id);
            let lookup = client.get(&lookup_url).send().await?;
            if lookup.status().is_success() {
                Ok(())
            } else {
                let status = lookup.status();
                let body = lookup.text().await.unwrap_or_default();
                bail!("quickwit index lookup failed with status {status}: {body}");
            }
        }
        status => {
            let body = response.text().await.unwrap_or_default();
            bail!("quickwit create index failed with status {status}: {body}");
        }
    }
}

pub async fn delete_quickwit_index(client: &Client, endpoint: &str, index_id: &str) -> Result<()> {
    let base = endpoint.trim_end_matches('/');
    let url = format!("{}/api/v1/indexes/{}", base, index_id);
    let response = client.delete(&url).send().await?;
    match response.status() {
        status if status.is_success() => Ok(()),
        StatusCode::NOT_FOUND => Ok(()),
        status => {
            let body = response.text().await.unwrap_or_default();
            bail!("quickwit delete index failed with status {status}: {body}");
        }
    }
}

pub fn extract_document_id(hit: &Value) -> Option<Uuid> {
    for key in ["_source", "source", "fields", "stored_fields"] {
        if let Some(value) = hit.get(key) {
            if let Some(uuid) = extract_uuid_from_value(value) {
                return Some(uuid);
            }
        }
    }

    if let Some(value) = hit.get("document_id") {
        if let Some(uuid) = extract_uuid_from_value(value) {
            return Some(uuid);
        }
    }

    None
}

pub fn extract_uuid_from_value(value: &Value) -> Option<Uuid> {
    if let Some(obj) = value.as_object() {
        if let Some(inner) = obj.get("document_id") {
            return parse_uuid_value(inner);
        }
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(uuid) = extract_uuid_from_value(item) {
                return Some(uuid);
            }
        }
    }

    parse_uuid_value(value)
}

pub fn parse_uuid_value(value: &Value) -> Option<Uuid> {
    if let Some(s) = value.as_str() {
        return Uuid::parse_str(s).ok();
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(uuid) = parse_uuid_value(item) {
                return Some(uuid);
            }
        }
    }

    None
}

#[derive(Deserialize)]
struct QuickwitSearchResponse {
    #[serde(default)]
    hits: Vec<Value>,
}

#[derive(Serialize)]
pub struct QuickwitIngestRecord {
    pub document_id: Uuid,
    pub version_id: Uuid,
    pub tenant_id: Uuid,
    pub title: String,
    pub text: String,
}

pub fn build_quickwit_ingest_record(
    document: &Document,
    version: &DocumentVersion,
    tenant_id: Uuid,
    text: &str,
) -> QuickwitIngestRecord {
    QuickwitIngestRecord {
        document_id: document.id,
        version_id: version.id,
        tenant_id,
        title: document.title.to_lowercase(),
        text: text.to_lowercase(),
    }
}

pub async fn quickwit_ingest(
    client: &Client,
    endpoint: &str,
    index: &str,
    records: &[QuickwitIngestRecord],
) -> Result<()> {
    if records.is_empty() {
        return Ok(());
    }

    let url = format!(
        "{}/api/v1/{}/ingest?commit=auto",
        endpoint.trim_end_matches('/'),
        index
    );

    let mut body = String::new();
    for record in records {
        let line = serde_json::to_string(record)?;
        body.push_str(&line);
        body.push('\n');
    }

    debug!(%url, lines = records.len(), "sending quickwit ingest request");
    let response = client
        .post(url)
        .header("content-type", "application/x-ndjson")
        .body(body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!(%status, %body, "quickwit ingest request failed");
        return Err(anyhow!(
            "quickwit ingest failed with status {status}: {body}"
        ));
    }

    debug!("quickwit ingest request succeeded");
    Ok(())
}
