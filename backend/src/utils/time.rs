use chrono::{DateTime, NaiveDateTime, Utc};

/// Format a timestamp as RFC3339 using UTC.
pub fn to_iso(dt: NaiveDateTime) -> String {
    DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc).to_rfc3339()
}

/// Format a timestamp for HTTP headers (RFC 7231 date).
pub fn to_http_date(dt: NaiveDateTime) -> String {
    DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string()
}
