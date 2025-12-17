use std::sync::Arc;

use axum::{
    http::{Request, StatusCode},
    response::IntoResponse,
};
use tower::{Layer, Service};

use crate::{auth::AuthenticatedUser, error::AppError, models::ApiCapability};

#[derive(Clone, Copy)]
pub enum CapabilityStrategy {
    All,
    Any,
}

#[derive(Clone)]
pub struct RequireCapabilitiesLayer {
    required: Arc<Vec<ApiCapability>>,
    strategy: CapabilityStrategy,
}

impl RequireCapabilitiesLayer {
    pub fn all<I>(caps: I) -> Self
    where
        I: IntoIterator<Item = ApiCapability>,
    {
        Self {
            required: Arc::new(caps.into_iter().collect()),
            strategy: CapabilityStrategy::All,
        }
    }

    pub fn any<I>(caps: I) -> Self
    where
        I: IntoIterator<Item = ApiCapability>,
    {
        Self {
            required: Arc::new(caps.into_iter().collect()),
            strategy: CapabilityStrategy::Any,
        }
    }
}

impl<S> Layer<S> for RequireCapabilitiesLayer {
    type Service = RequireCapabilities<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RequireCapabilities {
            inner,
            required: Arc::clone(&self.required),
            strategy: self.strategy,
        }
    }
}

#[derive(Clone)]
pub struct RequireCapabilities<S> {
    inner: S,
    required: Arc<Vec<ApiCapability>>,
    strategy: CapabilityStrategy,
}

impl<S, B> Service<Request<B>> for RequireCapabilities<S>
where
    S: Service<Request<B>, Response = axum::response::Response> + Send,
    S::Future: Send + 'static,
    B: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<B>) -> Self::Future {
        if self.required.is_empty() {
            let fut = self.inner.call(req);
            return Box::pin(async move { fut.await });
        }

        let (parts, body) = req.into_parts();
        let user = match parts.extensions.get::<AuthenticatedUser>() {
            Some(user) => user,
            None => {
                let response = AppError::unauthorized().into_response();
                return Box::pin(async move { Ok(response) });
            }
        };

        let allowed = match self.strategy {
            CapabilityStrategy::All => self
                .required
                .iter()
                .all(|cap| user.capabilities.contains(cap)),
            CapabilityStrategy::Any => self
                .required
                .iter()
                .any(|cap| user.capabilities.contains(cap)),
        };

        if !allowed {
            let response = AppError::new(StatusCode::FORBIDDEN, "missing required capability")
                .with_code("missing_capability")
                .into_response();
            return Box::pin(async move { Ok(response) });
        }

        let req = Request::from_parts(parts, body);
        let fut = self.inner.call(req);
        Box::pin(async move { fut.await })
    }
}
