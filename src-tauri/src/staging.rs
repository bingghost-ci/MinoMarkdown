//! Binary hand-off between the webview and Rust. Image bytes cross IPC as raw bodies and JSON
//! payloads carry only short ids, so nothing is serialized as an array of numbers.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{Duration, Instant}};
use tauri::{ipc::{InvokeBody, Request, Response}, State, WebviewWindow};

const MAX_ITEM: usize = 20 * 1024 * 1024;
const MAX_TOTAL: usize = 512 * 1024 * 1024;
const MAX_AGE: Duration = Duration::from_secs(5 * 60);
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct StagingStore(Mutex<HashMap<String, (Vec<u8>, Instant)>>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAsset { pub url: String, pub mime: String, pub staged: String }

impl StagingStore {
    pub fn put(&self, bytes: Vec<u8>) -> Result<String, String> {
        let mut items = self.0.lock().map_err(|_| "IO_ERROR")?;
        items.retain(|_, (_, created)| created.elapsed() < MAX_AGE);
        let held: usize = items.values().map(|(item, _)| item.len()).sum();
        if held.saturating_add(bytes.len()) > MAX_TOTAL { return Err("STAGING_BUDGET".into()); }
        let id = format!("staged-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        items.insert(id.clone(), (bytes, Instant::now()));
        Ok(id)
    }
    pub fn take(&self, id: &str) -> Result<Vec<u8>, String> {
        self.0.lock().map_err(|_| "IO_ERROR")?.remove(id).map(|(bytes, _)| bytes).ok_or("STAGED_NOT_FOUND".into())
    }
}

#[tauri::command(async)]
pub fn stage_binary(window: WebviewWindow, store: State<'_, StagingStore>, request: Request<'_>) -> Result<String, String> {
    crate::require_workspace_window(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("INVALID_ASSET".into()) };
    if bytes.is_empty() || bytes.len() > MAX_ITEM { return Err("IMAGE_TOO_LARGE".into()); }
    store.put(bytes.clone())
}

#[tauri::command(async)]
pub fn read_staged(window: WebviewWindow, store: State<'_, StagingStore>, id: String) -> Result<Response, String> {
    crate::require_workspace_window(&window)?;
    Ok(Response::new(store.take(&id)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn staged_bytes_are_handed_over_once() {
        let store = StagingStore::default();
        let id = store.put(vec![1, 2, 3]).unwrap();
        assert_eq!(store.take(&id).unwrap(), vec![1, 2, 3]);
        assert_eq!(store.take(&id).err().as_deref(), Some("STAGED_NOT_FOUND"));
    }
    #[test]
    fn budget_is_enforced() {
        let store = StagingStore::default();
        store.put(vec![0; MAX_TOTAL - 1]).unwrap();
        assert_eq!(store.put(vec![0; 2]).err().as_deref(), Some("STAGING_BUDGET"));
    }
}
