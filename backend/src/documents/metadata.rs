use serde_json::{map::Entry, Map, Value};

use crate::error::{AppError, AppResult};

pub fn merge_document_metadata(existing: Value, updates: Value) -> AppResult<Value> {
    let mut base = match existing {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        _ => {
            return Err(AppError::bad_request(
                "existing metadata is not an object; set replace=true to overwrite",
            ));
        }
    };

    let incoming = match updates {
        Value::Object(map) => map,
        _ => {
            return Err(AppError::bad_request(
                "metadata value must be a JSON object when replace is false",
            ));
        }
    };

    merge_metadata_maps(&mut base, incoming);
    Ok(Value::Object(base))
}

fn merge_metadata_maps(target: &mut Map<String, Value>, updates: Map<String, Value>) {
    for (key, value) in updates {
        match target.entry(key) {
            Entry::Occupied(mut entry) => {
                let existing = entry.get_mut();
                match value {
                    Value::Object(update_map) => {
                        if let Value::Object(existing_map) = existing {
                            merge_metadata_maps(existing_map, update_map);
                        } else {
                            *existing = Value::Object(update_map);
                        }
                    }
                    other => {
                        *existing = other;
                    }
                }
            }
            Entry::Vacant(entry) => {
                entry.insert(value);
            }
        }
    }
}
