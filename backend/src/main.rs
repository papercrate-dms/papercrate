use std::net::SocketAddr;

use tokio::net::TcpListener;
use tower::make::Shared;

use papercrate::{routes, utils::bootstrap::init_component};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let state = init_component("api", None).await?;
    let server_host = state.config.server_host.clone();
    let server_port = state.config.server_port;
    tracing::info!(
        component = "api",
        server_host = %server_host,
        server_port,
        "starting api server"
    );

    let router = routes::create_router(state.as_ref().clone());

    let addr: SocketAddr = format!("{}:{}", server_host, server_port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("listening on {}", addr);

    axum::serve(listener, Shared::new(router)).await?;
    Ok(())
}
