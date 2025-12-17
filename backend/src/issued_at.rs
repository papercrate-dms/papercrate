use std::collections::HashSet;

use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use once_cell::sync::Lazy;
use tracing::warn;

use crate::config::AppConfig;

#[derive(Clone, Copy, Debug)]
pub enum DateOrder {
    Dmy,
    Mdy,
    Ymd,
}

impl DateOrder {
    pub fn parse(value: &str) -> Self {
        Self::try_parse(value).unwrap_or(DateOrder::Dmy)
    }

    pub fn try_parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "YMD" => Some(DateOrder::Ymd),
            "MDY" => Some(DateOrder::Mdy),
            "DMY" => Some(DateOrder::Dmy),
            _ => None,
        }
    }
}

static MIN_ISSUED_AT_DATE: Lazy<NaiveDate> =
    Lazy::new(|| NaiveDate::from_ymd_opt(1901, 1, 1).expect("valid minimum issued_at date"));

#[derive(Clone, Debug)]
pub struct IssuedAtSettings {
    pub timezone: Tz,
    pub date_order: DateOrder,
    pub filename_date_order: Option<DateOrder>,
    pub locales: HashSet<String>,
    pub ignore_dates: HashSet<NaiveDate>,
    pub min_date: NaiveDate,
}

impl IssuedAtSettings {
    pub fn from_config(config: &AppConfig) -> Self {
        let timezone = config.service_timezone.parse::<Tz>().unwrap_or_else(|_| {
            warn!(
                timezone = %config.service_timezone,
                "invalid service timezone configured; falling back to UTC"
            );
            chrono_tz::UTC
        });

        let date_order = DateOrder::parse(&config.issued_at_date_order);
        let filename_date_order =
            config
                .issued_at_filename_date_order
                .as_deref()
                .and_then(|value| {
                    DateOrder::try_parse(value).or_else(|| {
                        warn!(value, "invalid issued_at filename date order; ignoring");
                        None
                    })
                });

        let locales = config
            .issued_at_date_parser_locales
            .iter()
            .filter_map(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_ascii_lowercase())
                }
            })
            .collect::<HashSet<_>>();

        // Ignore dates are evaluated after normalizing candidate timestamps to
        // the configured service timezone, so administrators should provide
        // local calendar dates rather than UTC midnights.
        let ignore_dates = config
            .issued_at_ignore_dates
            .iter()
            .filter_map(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return None;
                }
                match NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
                    Ok(date) => Some(date),
                    Err(err) => {
                        warn!(value = trimmed, error = %err, "invalid issued_at ignore date");
                        None
                    }
                }
            })
            .collect();

        Self {
            timezone,
            date_order,
            filename_date_order,
            locales,
            ignore_dates,
            min_date: *MIN_ISSUED_AT_DATE,
        }
    }

    /// Returns the immutable (lowercase) locale allowlist supplied via config.
    pub fn locales(&self) -> &HashSet<String> {
        &self.locales
    }

    /// Returns the immutable set of local-calendar dates that should be ignored.
    pub fn ignore_dates(&self) -> &HashSet<NaiveDate> {
        &self.ignore_dates
    }

    /// Returns the configured service timezone (copy type).
    pub fn timezone(&self) -> Tz {
        self.timezone
    }

    pub fn date_order(&self) -> DateOrder {
        self.date_order
    }

    pub fn filename_date_order(&self) -> Option<DateOrder> {
        self.filename_date_order
    }

    pub fn normalize_naive(
        &self,
        date: NaiveDate,
        now_utc: chrono::DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        if !self.is_valid_with_now(date, now_utc) {
            return None;
        }
        self.timezone
            .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
            .earliest()
            .map(|dt| dt.with_timezone(&Utc))
    }

    pub fn normalize_datetime(
        &self,
        dt: chrono::DateTime<Utc>,
        now_utc: chrono::DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        let local_date = dt.with_timezone(&self.timezone).date_naive();
        self.normalize_naive(local_date, now_utc)
    }

    fn is_valid_with_now(&self, date: NaiveDate, now_utc: chrono::DateTime<Utc>) -> bool {
        if date < self.min_date {
            return false;
        }
        let now_local = now_utc.with_timezone(&self.timezone).date_naive();
        if date > now_local {
            return false;
        }
        !self.ignore_dates.contains(&date)
    }
}
