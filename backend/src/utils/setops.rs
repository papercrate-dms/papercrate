use std::collections::HashSet;
use std::hash::Hash;

use uuid::Uuid;

use crate::error::AppResult;


/// Intersect an optional base set with a new set, returning the resulting option.
pub fn intersect_option_sets<T>(base: Option<HashSet<T>>, next: HashSet<T>) -> Option<HashSet<T>>
where
    T: Eq + Hash + Copy,
{
    Some(match base {
        Some(existing) => existing.intersection(&next).copied().collect(),
        None => next,
    })
}

/// Iteratively intersect documents linked via a join table loader.
pub fn load_linked_doc_ids<F>(
    conn: &mut diesel::PgConnection,
    ids: &[Uuid],
    mut loader: F,
) -> AppResult<HashSet<Uuid>>
where
    F: FnMut(&mut diesel::PgConnection, Uuid) -> AppResult<HashSet<Uuid>>,
{
    let mut current: Option<HashSet<Uuid>> = None;

    for id in ids {
        let docs_set = loader(conn, *id)?;
        current = intersect_option_sets(current, docs_set);

        if current.as_ref().is_some_and(|set| set.is_empty()) {
            break;
        }
    }

    Ok(current.unwrap_or_default())
}
