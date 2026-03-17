use std::net::SocketAddr;

use tokio::net::TcpListener;
use tower::make::Shared;

use papercrate::{routes::webdav, utils::bootstrap::init_component};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let state = init_component("webdav", None).await?;
    let webdav_host = state.config.webdav_host.clone();
    let webdav_port = state.config.webdav_port;
    let webdav_prefix = state.config.webdav_prefix();
    tracing::info!(
        component = "webdav",
        webdav_host = %webdav_host,
        webdav_port,
        webdav_path_prefix = %webdav_prefix,
        "starting webdav server"
    );

    let listen_addr: SocketAddr = format!("{}:{}", webdav_host, webdav_port).parse()?;
    let router = webdav::create_router().with_state(state.as_ref().clone());

    let listener = TcpListener::bind(listen_addr).await?;
    tracing::info!("listening for WebDAV on {}", listen_addr);

    axum::serve(listener, Shared::new(router)).await?;
    Ok(())
}
