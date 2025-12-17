use axum::{extract::State, http::StatusCode, response::Json};
use diesel::RunQueryDsl;
use serde_json::json;

use crate::state::AppState;

#[derive(utoipa::OpenApi)]
#[openapi(paths(crate::routes::health::health_check))]
pub struct HealthApiDoc;

#[utoipa::path(
    get,
    path = "/api/health",
    responses((status = 200, description = "Service is healthy")),
    tag = "Health"
)]
pub async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let database_ok = match state.db_unscoped() {
        Ok(mut conn) => diesel::sql_query("SELECT 1")
            .execute(&mut conn)
            .map(|_| true)
            .unwrap_or_else(|err| {
                tracing::error!(error = ?err, "health check database ping failed");
                false
            }),
        Err(err) => {
            tracing::error!(error = ?err, "health check database connection failed");
            false
        }
    };

    let status = if database_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let payload = json!({
        "status": if database_ok { "ok" } else { "error" },
        "checks": {
            "database": if database_ok { "ok" } else { "unavailable" }
        }
    });

    (status, Json(payload))
}
