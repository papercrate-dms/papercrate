pub(super) struct MonthVariant {
    pub name: &'static str,
    pub month: u32,
    pub locales: &'static [&'static str],
}

include!(concat!(env!("OUT_DIR"), "/issued_at_months.rs"));

pub(super) fn pattern() -> &'static str {
    MONTH_PATTERN
}

pub(super) fn variants() -> &'static [MonthVariant] {
    MONTH_VARIANTS
}
