use std::time::Duration;

use async_trait::async_trait;
use thiserror::Error;
use tracing::info;
use uuid::Uuid;

pub mod document;

pub type TaskResult<T> = Result<T, TaskError>;

#[derive(Debug, Error)]
pub enum TaskError {
    #[error("{error}")]
    Fail { error: String },
    #[error("{error}")]
    Retry { delay: Duration, error: String },
}

impl TaskError {
    pub fn fail(error: impl Into<String>) -> Self {
        Self::Fail {
            error: error.into(),
        }
    }

    pub fn retry(delay: Duration, error: impl Into<String>) -> Self {
        Self::Retry {
            delay,
            error: error.into(),
        }
    }
}

pub trait TaskContext: Send + Sync {
    fn job_id(&self) -> Uuid;
    fn job_type(&self) -> &'static str;
}

#[async_trait]
pub trait Task<Ctx>: Send + Sync
where
    Ctx: TaskContext,
{
    fn name(&self) -> &'static str;
    async fn execute(&self, ctx: &mut Ctx) -> TaskResult<()>;
}

pub type BoxedTask<Ctx> = Box<dyn Task<Ctx> + Send + Sync>;

#[async_trait]
pub trait TaskPlanner<Ctx>: Send + Sync
where
    Ctx: TaskContext,
{
    async fn plan(&self, ctx: &mut Ctx) -> TaskResult<Vec<BoxedTask<Ctx>>>;
}

pub struct TaskExecutor;

impl TaskExecutor {
    pub async fn run<P, C>(planner: &P, ctx: &mut C) -> TaskResult<()>
    where
        P: TaskPlanner<C>,
        C: TaskContext,
    {
        let tasks = planner.plan(ctx).await?;
        for task in tasks {
            info!(
                job_id = %ctx.job_id(),
                job_type = ctx.job_type(),
                task = task.name(),
                "starting job task"
            );
            task.execute(ctx).await?;
            info!(
                job_id = %ctx.job_id(),
                job_type = ctx.job_type(),
                task = task.name(),
                "finished job task"
            );
        }
        Ok(())
    }
}
