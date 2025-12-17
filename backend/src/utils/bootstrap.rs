use std::sync::Arc;

use anyhow::Result;

use crate::{config::AppConfig, state::AppState, utils::tracing::init_tracing};

/// Initialize tracing, load configuration, and build the shared `AppState`.
/// Optionally override the connection pool size for lightweight components.
pub async fn init_component(name: &str, pool_override: Option<u32>) -> Result<Arc<AppState>> {
    init_tracing("info");
    let config = AppConfig::load_and_log(name)?;
    let state = AppState::initialize(config, pool_override).await?;
    Ok(Arc::new(state))
}
