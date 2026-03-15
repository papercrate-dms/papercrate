use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, TimeZone, Utc};
use diesel::prelude::*;
use once_cell::sync::Lazy;
use regex::Match;
use regex::Regex;
use serde_json::Value;
use tracing::{info, warn};
use uuid::Uuid;

use crate::issued_at::{DateOrder, IssuedAtSettings};
use crate::schema::documents::dsl as documents_dsl;
use crate::workers::ocr::TEXT_CONTENT_ASSET_TYPE;
use crate::workers::taskflow::document::DocumentVersionTaskContext;
use crate::workers::taskflow::{Task, TaskContext, TaskError, TaskResult};

#[path = "issued_at_months.rs"]
mod issued_at_months;

const MAX_FILENAME_CHARS: usize = 256;
const MAX_TEXT_CHARS: usize = 50_000;
const DATE_SEP_PATTERN: &str = r"[\s._/\-]+";

static YMD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?u)\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b").expect("ymd regex"));

static NUMERIC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b").expect("numeric regex")
});

static DAY_MONTH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?u)\b(\d{{1,2}})(?:st|nd|rd|th)?{SEP}({MONTH_PATTERN}){SEP}(\d{{2,4}})\b",
        SEP = DATE_SEP_PATTERN,
        MONTH_PATTERN = month_pattern()
    ))
    .expect("day month regex")
});

static MONTH_DAY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?u)\b({MONTH_PATTERN}){SEP}(\d{{1,2}})(?:st|nd|rd|th)?(?:,)?{SEP}(\d{{2,4}})\b",
        SEP = DATE_SEP_PATTERN,
        MONTH_PATTERN = month_pattern()
    ))
    .expect("month day regex")
});

static MONTH_YEAR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?u)\b({MONTH_PATTERN})[\s._-]*(\d{{4}})\b",
        MONTH_PATTERN = month_pattern()
    ))
    .expect("month year regex")
});

fn month_pattern() -> &'static str {
    issued_at_months::pattern()
}

pub struct DetermineIssuedAtTask;

impl DetermineIssuedAtTask {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Task<DocumentVersionTaskContext> for DetermineIssuedAtTask {
    fn name(&self) -> &'static str {
        "determine-issued-at"
    }

    async fn execute(&self, ctx: &mut DocumentVersionTaskContext) -> TaskResult<()> {
        let document = ctx.document().await?.clone();
        if document.issued_at.is_some() {
            return Ok(());
        }

        let version = ctx.version().await?.clone();
        let settings = ctx.state().issued_at_settings();
        let now_utc = Utc::now();

        let parser_hint = parser_supplied_date(&document.metadata, &version.metadata, &settings)
            .and_then(|dt| settings.normalize_datetime(dt, now_utc));

        let filename_candidate = settings.filename_date_order().and_then(|order| {
            let normalized = normalize_content(&document.original_name, MAX_FILENAME_CHARS);
            find_date_in_text(&normalized, order, &settings, now_utc)
        });

        let text_candidate = load_document_text(ctx).await?.and_then(|text| {
            let normalized = normalize_content(&text, MAX_TEXT_CHARS);
            find_date_in_text(&normalized, settings.date_order(), &settings, now_utc)
        });

        if let Some((final_date, source)) = parser_hint
            .map(|dt| (dt, IssuedAtSource::Parser))
            .or_else(|| filename_candidate.map(|dt| (dt, IssuedAtSource::Filename)))
            .or_else(|| text_candidate.map(|dt| (dt, IssuedAtSource::Text)))
        {
            persist_issued_at(ctx, document.id, final_date.naive_utc()).await?;
            info!(
                job_id = %ctx.job_id(),
                document_id = %document.id,
                issued_at = %final_date,
                source = source.as_ref(),
                "issued_at determined"
            );
        } else {
            info!(
                job_id = %ctx.job_id(),
                document_id = %document.id,
                "no issued_at signals discovered; leaving unset"
            );
        }

        Ok(())
    }
}

async fn persist_issued_at(
    ctx: &DocumentVersionTaskContext,
    document_id: Uuid,
    issued_at: NaiveDateTime,
) -> TaskResult<()> {
    let tenant_id = ctx.tenant_id();
    let state = ctx.state().clone();
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut conn = state
            .db_for_tenant(tenant_id)
            .map_err(|err| format!("failed to scope connection: {err:?}"))?;
        conn.scoped(|tx| -> Result<(), diesel::result::Error> {
            diesel::update(
                documents_dsl::documents
                    .filter(documents_dsl::tenant_id.eq(tenant_id))
                    .filter(documents_dsl::id.eq(document_id)),
            )
            .set(documents_dsl::issued_at.eq(issued_at))
            .execute(tx)?;
            Ok(())
        })
        .map_err(|err| format!("failed to update issued_at: {err}"))
    })
    .await
    .map_err(|err| {
        TaskError::retry(
            Duration::from_secs(30),
            format!("issued_at task panicked: {err}"),
        )
    })?;
    result.map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;
    Ok(())
}

fn parser_supplied_date(
    document_meta: &Value,
    version_meta: &Value,
    settings: &IssuedAtSettings,
) -> Option<DateTime<Utc>> {
    metadata_datetime(document_meta)
        .or_else(|| metadata_datetime(version_meta))
        .and_then(|raw| parse_hint_datetime(raw, settings))
}

fn metadata_datetime(value: &Value) -> Option<&str> {
    match value {
        Value::String(s) => Some(s.as_str()),
        Value::Object(map) => {
            for key in [
                "issued_at_override",
                "issued_at",
                "source_date",
                "created_at",
            ] {
                if let Some(Value::String(s)) = map.get(key) {
                    return Some(s.as_str());
                }
            }
            if let Some(Value::Object(parser)) = map.get("parser") {
                if let Some(Value::String(s)) = parser.get("issued_at") {
                    return Some(s.as_str());
                }
            }
            None
        }
        _ => None,
    }
}

fn parse_hint_datetime(raw: &str, settings: &IssuedAtSettings) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }

    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return settings
            .timezone()
            .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
            .single()
            .map(|dt| dt.with_timezone(&Utc));
    }

    None
}

fn normalize_content(input: &str, limit: usize) -> String {
    let truncated: String = input.chars().take(limit).collect();
    let mut normalized = String::with_capacity(truncated.len());
    for ch in truncated.chars() {
        if ch.is_control() {
            normalized.push(' ');
        } else {
            normalized.extend(ch.to_lowercase());
        }
    }
    normalized
}

fn find_date_in_text(
    text: &str,
    order: DateOrder,
    settings: &IssuedAtSettings,
    now_utc: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    collect_matches_with_spans(text, order, settings, now_utc)
        .into_iter()
        .map(|(_, dt)| dt)
        .next()
}

fn collect_matches_with_spans(
    text: &str,
    order: DateOrder,
    settings: &IssuedAtSettings,
    now_utc: DateTime<Utc>,
) -> Vec<(usize, DateTime<Utc>)> {
    let mut matches: Vec<(usize, usize, DateTime<Utc>)> = Vec::new();
    let mut push_date = |span: Option<Match>, date: NaiveDate| {
        if let Some(dt) = settings.normalize_naive(date, now_utc) {
            if let Some(span) = span {
                let start = span.start();
                let end = span.end();
                if let Some(existing) =
                    matches
                        .iter_mut()
                        .find(|(existing_start, existing_end, _)| {
                            *existing_start != usize::MAX
                                && start < *existing_end
                                && *existing_start < end
                        })
                {
                    let existing_len = existing.1.saturating_sub(existing.0);
                    let new_len = end.saturating_sub(start);
                    if new_len > existing_len {
                        *existing = (start, end, dt);
                    }
                    return;
                }
                matches.push((start, end, dt));
            } else {
                matches.push((usize::MAX, usize::MAX, dt));
            }
        }
    };

    for caps in YMD_RE.captures_iter(text) {
        let (Some(year_match), Some(month_match), Some(day_match)) =
            (caps.get(1), caps.get(2), caps.get(3))
        else {
            continue;
        };
        let year = match year_match.as_str().parse::<i32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let month = match month_match.as_str().parse::<u32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let day = match day_match.as_str().parse::<u32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            push_date(caps.get(0), date);
        }
    }

    for caps in NUMERIC_RE.captures_iter(text) {
        let (Some(first_match), Some(second_match), Some(year_match)) =
            (caps.get(1), caps.get(2), caps.get(3))
        else {
            continue;
        };
        let first = match first_match.as_str().parse::<u32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let second = match second_match.as_str().parse::<u32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let year_raw = year_match.as_str();
        let mut year = match year_raw.parse::<i32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if year_raw.len() == 2 {
            year += if year >= 70 { 1900 } else { 2000 };
        }
        // NUMERIC_RE always captures a day-first form (dd[sep]mm[sep]yy(yy));
        // YMD layouts are handled earlier by YMD_RE, so YMD here is treated the
        // same as DMY to avoid mis-parsing strings like 01-07-2024.
        let (day, month) = match order {
            DateOrder::Dmy | DateOrder::Ymd => (first, second),
            DateOrder::Mdy => (second, first),
        };
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            push_date(caps.get(0), date);
        }
    }

    for caps in DAY_MONTH_RE.captures_iter(text) {
        let (Some(day_match), Some(month_match), Some(year_match)) =
            (caps.get(1), caps.get(2), caps.get(3))
        else {
            continue;
        };
        let day_str = day_match
            .as_str()
            .trim_matches(|c: char| !c.is_ascii_digit());
        let day = match day_str.parse::<u32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(month) = month_name_to_number(month_match.as_str(), settings) else {
            continue;
        };
        if year_match.as_str().len() < 3 {
            continue;
        }
        let Some(year) = normalize_year(year_match.as_str()) else {
            continue;
        };
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            push_date(caps.get(0), date);
        }
    }

    for caps in MONTH_DAY_RE.captures_iter(text) {
        let (Some(month_match), Some(day_match), Some(year_match)) =
            (caps.get(1), caps.get(2), caps.get(3))
        else {
            continue;
        };
        let Some(month) = month_name_to_number(month_match.as_str(), settings) else {
            continue;
        };
        let day_str = day_match
            .as_str()
            .trim_matches(|c: char| !c.is_ascii_digit());
        let day = match day_str.parse::<u32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(year) = normalize_year(year_match.as_str()) else {
            continue;
        };
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            push_date(caps.get(0), date);
        }
    }

    for caps in MONTH_YEAR_RE.captures_iter(text) {
        let (Some(month_match), Some(year_match)) = (caps.get(1), caps.get(2)) else {
            continue;
        };
        let Some(month) = month_name_to_number(month_match.as_str(), settings) else {
            continue;
        };
        let year = match year_match.as_str().parse::<i32>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, 1) {
            push_date(caps.get(0), date);
        }
    }

    matches.sort_by_key(|(start, _, _)| *start);
    matches
        .into_iter()
        .map(|(start, _, dt)| (start, dt))
        .collect()
}

fn normalize_year(raw: &str) -> Option<i32> {
    if raw.len() == 2 {
        let mut year = raw.parse::<i32>().ok()?;
        year += if year >= 70 { 1900 } else { 2000 };
        Some(year)
    } else {
        raw.parse::<i32>().ok()
    }
}

fn month_name_to_number(value: &str, settings: &IssuedAtSettings) -> Option<u32> {
    let normalized = value.trim();
    let variant = issued_at_months::variants()
        .iter()
        .find(|entry| entry.name == normalized)?;
    if settings.locales().is_empty() || variant.locales.is_empty() {
        return Some(variant.month);
    }
    if variant
        .locales
        .iter()
        .any(|locale| settings.locales().contains(*locale))
    {
        Some(variant.month)
    } else {
        None
    }
}

/// Maximum bytes to fetch from S3. We allow 4x the char limit to account for
/// multi-byte UTF-8 sequences, then truncate to `MAX_TEXT_CHARS` characters
/// after decoding.
const MAX_TEXT_FETCH_BYTES: u64 = (MAX_TEXT_CHARS as u64) * 4;

async fn load_document_text(ctx: &mut DocumentVersionTaskContext) -> TaskResult<Option<String>> {
    let object_key = {
        let asset = ctx.asset(TEXT_CONTENT_ASSET_TYPE).await?;
        asset.map(|a| a.asset.s3_key.clone())
    };

    let Some(key) = object_key else {
        return Ok(None);
    };

    match ctx
        .storage()
        .get_object_range(&key, 0, Some(MAX_TEXT_FETCH_BYTES))
        .await
    {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(mut text) => {
                if text.len() > MAX_TEXT_CHARS {
                    text.truncate(MAX_TEXT_CHARS);
                }
                Ok(Some(text))
            }
            Err(err) => {
                warn!(error = %err, "ocr text asset not valid utf-8");
                Ok(None)
            }
        },
        Err(err) => {
            warn!(error = %err, "failed to download ocr text for issued_at extractor");
            Ok(None)
        }
    }
}

#[derive(Copy, Clone)]
enum IssuedAtSource {
    Parser,
    Filename,
    Text,
}

impl IssuedAtSource {
    fn as_ref(&self) -> &'static str {
        match self {
            IssuedAtSource::Parser => "parser",
            IssuedAtSource::Filename => "filename",
            IssuedAtSource::Text => "text",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use serde::Deserialize;
    use serde_yaml::Value as YamlValue;

    use once_cell::sync::Lazy;

    #[derive(Clone, Deserialize)]
    struct CaseSuite {
        cases: Vec<CaseDefinition>,
    }

    #[derive(Clone, Deserialize)]
    struct CaseDefinition {
        name: String,
        parser: String,
        #[serde(default)]
        filename: Option<String>,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        settings: CaseSettings,
        expected: ExpectedCase,
    }

    #[derive(Clone, Default, Deserialize)]
    struct CaseSettings {
        #[serde(rename = "DATE_PARSER_LANGUAGES", default)]
        date_parser_languages: Vec<String>,
        #[serde(rename = "FILENAME_DATE_ORDER")]
        filename_date_order: Option<String>,
        #[serde(rename = "DATE_ORDER")]
        date_order: Option<String>,
        #[serde(rename = "IGNORE_DATES", default)]
        ignore_dates: Vec<String>,
    }

    #[derive(Clone, Deserialize)]
    struct ExpectedCase {
        mode: ExpectedMode,
        #[serde(default)]
        value: Option<YamlValue>,
    }

    #[derive(Clone, Deserialize, PartialEq)]
    #[serde(rename_all = "lowercase")]
    enum ExpectedMode {
        None,
        Single,
        Multiple,
    }

    static CASES: Lazy<CaseSuite> = Lazy::new(|| {
        let raw = include_str!("../../tests/data/issued_at_cases.yaml");
        serde_yaml::from_str(raw).expect("failed to parse issued_at cases")
    });

    pub(crate) fn run_named_case(name: &str) {
        let case = CASES
            .cases
            .iter()
            .find(|case| case.name == name)
            .unwrap_or_else(|| panic!("case '{}' not found", name))
            .clone();
        run_case(case);
    }

    fn run_case(case: CaseDefinition) {
        let mut config = base_config();
        if let Some(order) = case.settings.date_order {
            config.issued_at_date_order = order;
        }
        config.issued_at_filename_date_order = case.settings.filename_date_order;
        config.issued_at_date_parser_locales = case.settings.date_parser_languages;
        config.issued_at_ignore_dates = case.settings.ignore_dates;

        let settings = IssuedAtSettings::from_config(&config);
        let now_utc = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).single().unwrap();
        let mut matches = Vec::new();

        if let Some(filename) = &case.filename {
            if let Some(order) = settings.filename_date_order() {
                let normalized = normalize_content(filename, MAX_FILENAME_CHARS);
                matches.extend(
                    collect_matches_with_spans(&normalized, order, &settings, now_utc)
                        .into_iter()
                        .map(|(_, dt)| dt.date_naive()),
                );
            }
        }

        if let Some(content) = &case.content {
            let normalized = normalize_content(content, MAX_TEXT_CHARS);
            matches.extend(
                collect_matches_with_spans(&normalized, settings.date_order(), &settings, now_utc)
                    .into_iter()
                    .map(|(_, dt)| dt.date_naive()),
            );
        }

        let actual: Vec<String> = matches
            .into_iter()
            .map(|date| date.format("%Y-%m-%d").to_string())
            .collect();

        match case.parser.as_str() {
            "parse_date" => match case.expected.mode {
                ExpectedMode::None => assert!(
                    actual.is_empty(),
                    "case '{}' expected no matches, got {:?}",
                    case.name,
                    actual
                ),
                ExpectedMode::Single => {
                    let expected = case.expected.single_value();
                    assert!(
                        expected.is_some(),
                        "case '{}' is missing expected single value",
                        case.name
                    );
                    assert_eq!(
                        actual.first(),
                        expected.as_ref(),
                        "case '{}' single mismatch",
                        case.name
                    );
                }
                ExpectedMode::Multiple => panic!(
                    "case '{}' declares parse_date but expects multiple results",
                    case.name
                ),
            },
            "parse_date_generator" => {
                let expected = case.expected.multiple_values().unwrap_or_default();
                assert_eq!(expected, actual, "case '{}' multiple mismatch", case.name);
            }
            other => panic!("unsupported parser '{}' in case {}", other, case.name),
        }
    }

    impl ExpectedCase {
        fn single_value(&self) -> Option<String> {
            match self.value.as_ref()? {
                YamlValue::String(value) => Some(value.clone()),
                other => Some(other.as_str()?.to_string()),
            }
        }

        fn multiple_values(&self) -> Option<Vec<String>> {
            let list = match self.value.as_ref()? {
                YamlValue::Sequence(seq) => seq,
                _ => return None,
            };
            Some(
                list.iter()
                    .filter_map(|value| value.as_str().map(|s| s.to_string()))
                    .collect(),
            )
        }
    }

    fn base_config() -> AppConfig {
        AppConfig {
            database_url: "postgres://test".to_string(),
            migrations_database_url: None,
            database_max_pool_size: 5,
            server_host: "127.0.0.1".to_string(),
            server_port: 0,
            webdav_host: "127.0.0.1".to_string(),
            webdav_port: 0,
            jwt_secret: "secret".to_string(),
            jwt_issuer: "issuer".to_string(),
            jwt_audience: "audience".to_string(),
            jwt_expiry_minutes: 60,
            download_token_audience: "download".to_string(),
            download_token_expiry_minutes: 60,
            refresh_token_expiry_days: 30,
            refresh_cookie_secure: false,
            refresh_cookie_domain: None,
            cors_allowed_origin: None,
            proxy_downloads: false,
            aws_endpoint_url: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
            aws_region: "us-east-1".to_string(),
            s3_bucket: "bucket".to_string(),
            quickwit_endpoint: None,
            quickwit_index: None,
            worker_max_document_bytes: 100 * 1024 * 1024,
            upload_body_limit_bytes: 64 * 1024 * 1024,
            service_timezone: "UTC".to_string(),
            issued_at_date_order: "DMY".to_string(),
            issued_at_filename_date_order: None,
            issued_at_date_parser_locales: Vec::new(),
            issued_at_ignore_dates: Vec::new(),
            webauthn_rp_id: Some("localhost".to_string()),
            webauthn_origin: Some("http://localhost".to_string()),
            webauthn_rp_name: "Papercrate".to_string(),
        }
    }

    include!(concat!(env!("OUT_DIR"), "/issued_at_generated_tests.rs"));

    #[test]
    fn month_name_lookup_handles_turkish_variants() {
        let settings = IssuedAtSettings::from_config(&base_config());
        assert_eq!(month_name_to_number("şubat", &settings), Some(2));
        assert_eq!(month_name_to_number("subat", &settings), Some(2));
    }

    #[test]
    fn locale_filter_limits_month_names() {
        let mut config = base_config();
        config.issued_at_date_parser_locales = vec!["tr".into()];
        let settings = IssuedAtSettings::from_config(&config);
        assert_eq!(month_name_to_number("january", &settings), None);
        assert_eq!(month_name_to_number("şubat", &settings), Some(2));
    }
}
