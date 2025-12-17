use tracing_subscriber::EnvFilter;

/// Initialize tracing with an optional default level.
///
/// Falls back to `default_level` when `RUST_LOG` is not provided.
pub fn init_tracing(default_level: &str) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .compact()
        .init();
}
