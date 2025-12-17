use std::time::Duration;

use tokio::signal;

use papercrate::{default_handlers, utils::bootstrap::init_component, Worker};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let state = init_component("worker", Some(1)).await?;
    tracing::info!(component = "worker", "starting worker process");
    let worker = Worker::new(state, default_handlers(), Duration::from_secs(2));

    tokio::select! {
        _ = worker.run() => {}
        _ = signal::ctrl_c() => {
            tracing::info!("worker received shutdown signal");
        }
    }

    Ok(())
}
