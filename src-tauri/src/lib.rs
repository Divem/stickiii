mod ai;
mod credentials;
mod note_windows;
mod storage;
mod sync;

use credentials::{is_provider, public_config, ConfigStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use storage::Store;
use sync::{FeishuError, Network, SyncSession};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct AppState {
    store: Mutex<Store>,
    windows: Mutex<note_windows::Registry>,
    configs: Mutex<ConfigStore>,
    ai_configs: Mutex<ai::ConfigStore>,
    ai_busy: AtomicBool,
    shortcuts: Mutex<Vec<ShortcutConfig>>,
    sessions: Mutex<HashMap<String, SyncSession>>,
    network: tokio::sync::Mutex<Network>,
    ready: AtomicBool,
    exit_pending: AtomicBool,
    exit_allowed: AtomicBool,
}

fn trusted_url(url: &url::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(5173))
}

fn guard(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !window.url().is_ok_and(|url| trusted_url(&url)) {
        return Err("UNTRUSTED_WINDOW".into());
    }
    Ok(())
}

fn reveal(window: &WebviewWindow) -> Result<(), String> {
    if !window.is_visible().map_err(|_| "WINDOW_UNAVAILABLE")? {
        if let Ok(cursor) = window.cursor_position() {
            if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
                let scale = monitor.scale_factor();
                let area = monitor.work_area();
                let size = window.outer_size().map_err(|_| "WINDOW_UNAVAILABLE")?;
                let margin = 12.0 * scale;
                let x_min = area.position.x as f64 + margin;
                let y_min = area.position.y as f64 + margin;
                let x_max =
                    (area.position.x as f64 + area.size.width as f64 - size.width as f64 - margin)
                        .max(x_min);
                let y_max = (area.position.y as f64 + area.size.height as f64
                    - size.height as f64
                    - margin)
                    .max(y_min);
                let x = (cursor.x - size.width as f64 / 2.0).clamp(x_min, x_max);
                let y = (cursor.y + 18.0 * scale).clamp(y_min, y_max);
                window
                    .set_position(tauri::PhysicalPosition::new(x as i32, y as i32))
                    .map_err(|_| "WINDOW_UNAVAILABLE")?;
            }
        }
    }
    window.unminimize().map_err(|_| "WINDOW_UNAVAILABLE")?;
    window.show().map_err(|_| "WINDOW_UNAVAILABLE")?;
    window.set_focus().map_err(|_| "WINDOW_UNAVAILABLE")?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct ShortcutConfig {
    action: String,
    accelerator: String,
}

fn defaults() -> Vec<ShortcutConfig> {
    [
        ("toggleWindow", "CommandOrControl+Shift+Space"),
        ("newNote", "CommandOrControl+Shift+N"),
        ("previousNote", "CommandOrControl+Alt+Left"),
        ("nextNote", "CommandOrControl+Alt+Right"),
    ]
    .into_iter()
    .map(|(action, accelerator)| ShortcutConfig {
        action: action.into(),
        accelerator: accelerator.into(),
    })
    .collect()
}

fn valid_shortcuts(configs: &[ShortcutConfig]) -> bool {
    let mut actions = HashSet::new();
    let mut ids = HashSet::new();
    configs.len() == 4
        && configs.iter().all(|c| {
            matches!(
                c.action.as_str(),
                "toggleWindow" | "newNote" | "previousNote" | "nextNote"
            ) && actions.insert(&c.action)
                && Shortcut::from_str(&c.accelerator).is_ok_and(|s| ids.insert(s.id()))
        })
}

fn register_shortcuts(app: &AppHandle, configs: &[ShortcutConfig]) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|_| "SHORTCUT_CONFLICT")?;
    for config in configs {
        let action = config.action.clone();
        let shortcut = Shortcut::from_str(&config.accelerator).map_err(|_| "INVALID_SHORTCUT")?;
        if app
            .global_shortcut()
            .on_shortcut(shortcut, move |app, _, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    if action == "toggleWindow"
                        && window.is_visible().unwrap_or(false)
                        && window.is_focused().unwrap_or(false)
                        && !window.is_minimized().unwrap_or(false)
                    {
                        let _ = window.hide();
                    } else if reveal(&window).is_ok() {
                        let _ = note_windows::send(app, "main", "shortcut:action", &action);
                    }
                }
            })
            .is_err()
        {
            let _ = app.global_shortcut().unregister_all();
            return Err("SHORTCUT_CONFLICT".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn list_notes(window: WebviewWindow, state: State<AppState>) -> Result<Vec<Value>, String> {
    note_windows::guard(&window, &state)?;
    let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let id = registry.note_for(window.label())?;
    let store = state.store.lock().map_err(|_| "LOCAL_READ_FAILED")?;
    Ok(store
        .notes
        .iter()
        .filter(|note| id.is_none_or(|id| note["id"] == id))
        .cloned()
        .collect())
}
#[tauri::command]
async fn save_note(window: WebviewWindow, app: AppHandle, note: Value) -> Result<Value, String> {
    note_windows::guard(&window, &app.state::<AppState>())?;
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
        registry.authorize(&label, note["id"].as_str().ok_or("INVALID_NOTE")?, true)?;
        let mut store = state.store.lock().map_err(|_| "LOCAL_SAVE_FAILED")?;
        registry.authorize_attachments(
            &label,
            &note,
            store.notes.iter().find(|stored| stored["id"] == note["id"]),
        )?;
        let saved = store.save(note)?;
        drop(store);
        drop(registry);
        note_windows::notify_note(&app, &saved, &label);
        Ok(saved)
    })
    .await
    .map_err(|_| "LOCAL_SAVE_FAILED")?
}
#[tauri::command]
async fn delete_note(window: WebviewWindow, app: AppHandle, note_id: String) -> Result<(), String> {
    guard(&window)?;
    let state = app.state::<AppState>();
    // A restored window may exist before React installs its close listener.
    // Wait briefly for readiness instead of sending a request that is lost.
    for _ in 0..100 {
        let loading = {
            let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
            registry
                .owner(&note_id)
                .is_some_and(|owner| !registry.ready.contains(owner))
        };
        if !loading {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let pending = {
        let mut registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
        if state.exit_pending.load(Ordering::SeqCst) {
            return Err("EXIT_PENDING".into());
        }
        if let Some(owner) = registry.owner(&note_id).map(str::to_owned) {
            if !registry.ready.contains(&owner) {
                return Err("WINDOW_NOT_READY".into());
            }
            if registry.pending_deletes.contains_key(&owner) {
                return Err("NOTE_BUSY".into());
            }
            let (sender, receiver) = tokio::sync::oneshot::channel();
            registry.pending_deletes.insert(owner.clone(), sender);
            if note_windows::send(&app, &owner, "window:close-requested", ()).is_err() {
                registry.pending_deletes.remove(&owner);
                return Err("WINDOW_UNAVAILABLE".into());
            }
            Some(receiver)
        } else {
            None
        }
    };
    if let Some(receiver) = pending {
        return receiver.await.map_err(|_| "WINDOW_UNAVAILABLE")?;
    }
    let mut sessions = state.sessions.lock().map_err(|_| "SYNC_BUSY")?;
    sessions.retain(|_, s| s.touched.elapsed().as_secs() < 300);
    if sessions.values().any(|s| s.note_id == note_id) {
        return Err("SYNC_BUSY".into());
    }
    let result = state
        .store
        .lock()
        .map_err(|_| "LOCAL_SAVE_FAILED")?
        .delete(&note_id);
    result
}
#[tauri::command]
async fn pick_files(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Value>, String> {
    note_windows::guard(&window, &state)?;
    let paths =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_files())
            .await
            .map_err(|_| "FILE_PICK_FAILED")?;
    let root = state
        .store
        .lock()
        .map_err(|_| "ATTACHMENT_COPY_FAILED")?
        .root
        .clone();
    let picked: Vec<Value> = tauri::async_runtime::spawn_blocking(move || {
        paths
            .unwrap_or_default()
            .into_iter()
            .map(|path| {
                let path = path.into_path().map_err(|_| "INVALID_ATTACHMENT_PATH")?;
                Store::import_file(&root, &path)
            })
            .collect::<Result<Vec<Value>, String>>()
    })
    .await
    .map_err(|_| "ATTACHMENT_COPY_FAILED")??;
    let mut registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    registry.note_for(window.label())?;
    if window.label() != "main" {
        registry
            .imports
            .entry(window.label().into())
            .or_default()
            .extend(
                picked
                    .iter()
                    .filter_map(|attachment| attachment["storedPath"].as_str().map(str::to_owned)),
            );
    }
    Ok(picked)
}

#[tauri::command]
fn complete_exit(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
    saved: bool,
    request_id: String,
) -> Result<(), String> {
    note_windows::guard(&window, &state)?;
    if !state.exit_pending.load(Ordering::SeqCst) {
        return Err("EXIT_NOT_REQUESTED".into());
    }
    let complete = state
        .windows
        .lock()
        .map_err(|_| "WINDOW_UNAVAILABLE")?
        .acknowledge_exit(&request_id, window.label())?;
    if !saved {
        note_windows::cancel_exit(&app);
    } else if complete {
        let persisted = (|| {
            let mut registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
            for (label, id) in registry.bindings.clone() {
                let window = app.get_webview_window(&label).ok_or("WINDOW_UNAVAILABLE")?;
                let mut layout = note_windows::capture(&window, registry.layouts.get(&id))?;
                layout.open = true;
                registry.layouts.insert(id, layout);
            }
            registry.persist()
        })();
        if let Err(error) = persisted {
            note_windows::cancel_exit(&app);
            return Err(error);
        }
        state.exit_allowed.store(true, Ordering::SeqCst);
        app.exit(0);
    }
    Ok(())
}

#[tauri::command]
fn request_exit(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    guard(&window)?;
    app.exit(0);
    Ok(())
}
#[tauri::command]
fn open_attachment(
    window: WebviewWindow,
    state: State<AppState>,
    stored_path: String,
) -> Result<String, String> {
    note_windows::guard(&window, &state)?;
    let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let store = state.store.lock().map_err(|_| "INVALID_ATTACHMENT_PATH")?;
    if let Some(id) = registry.note_for(window.label())? {
        if !store
            .notes
            .iter()
            .find(|note| note["id"] == id)
            .is_some_and(|note| {
                note["attachments"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item["storedPath"] == stored_path))
            })
        {
            return Ok("INVALID_ATTACHMENT_PATH".into());
        }
    }
    let path = match storage::managed_path(&store.root.join("attachments"), &stored_path) {
        Ok(path) => path,
        Err(error) => return Ok(error),
    };
    Ok(if open::that_detached(path).is_ok() {
        ""
    } else {
        "FILE_OPEN_FAILED"
    }
    .into())
}
#[tauri::command]
fn open_external_link(window: WebviewWindow, url: String) -> Result<bool, String> {
    note_windows::guard(&window, &window.state::<AppState>())?;
    let Ok(parsed) = url::Url::parse(&url) else {
        return Ok(false);
    };
    if !matches!(parsed.scheme(), "https" | "http")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Ok(false);
    }
    Ok(open::that_detached(parsed.as_str()).is_ok())
}
#[tauri::command]
fn list_sync_configs(window: WebviewWindow, state: State<AppState>) -> Result<Vec<Value>, String> {
    note_windows::guard(&window, &state)?;
    state
        .configs
        .lock()
        .map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?
        .list()
}
#[tauri::command]
fn save_sync_config(
    window: WebviewWindow,
    state: State<AppState>,
    input: Value,
) -> Result<Value, String> {
    guard(&window)?;
    Ok(state
        .configs
        .lock()
        .map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?
        .save(&input))
}
#[tauri::command]
fn clear_sync_config(
    window: WebviewWindow,
    state: State<AppState>,
    provider: String,
) -> Result<Value, String> {
    guard(&window)?;
    Ok(state
        .configs
        .lock()
        .map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?
        .clear(&provider))
}
#[tauri::command]
fn get_ai_config(window: WebviewWindow, state: State<AppState>) -> Result<Option<Value>, String> {
    note_windows::guard(&window, &state)?;
    state
        .ai_configs
        .lock()
        .map_err(|_| "AI_CONFIG_UNAVAILABLE")?
        .get()
}
#[tauri::command]
fn save_ai_config(
    window: WebviewWindow,
    state: State<AppState>,
    input: ai::ConfigInput,
) -> Result<Value, String> {
    guard(&window)?;
    Ok(state
        .ai_configs
        .lock()
        .map_err(|_| "AI_CONFIG_UNAVAILABLE")?
        .save(input))
}
#[tauri::command]
fn clear_ai_config(window: WebviewWindow, state: State<AppState>) -> Result<Value, String> {
    guard(&window)?;
    Ok(state
        .ai_configs
        .lock()
        .map_err(|_| "AI_CONFIG_UNAVAILABLE")?
        .clear())
}

struct AiBusyGuard<'a>(&'a AtomicBool);
impl Drop for AiBusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
async fn test_ai_connection(
    window: WebviewWindow,
    state: State<'_, AppState>,
    input: ai::ConfigInput,
) -> Result<Value, String> {
    guard(&window)?;
    if state.ai_busy.swap(true, Ordering::SeqCst) {
        return Ok(json!({"status":"error","message":"busy"}));
    }
    let _busy = AiBusyGuard(&state.ai_busy);
    let config = state
        .ai_configs
        .lock()
        .map_err(|_| "AI_CONFIG_UNAVAILABLE")?
        .for_test(input);
    match config {
        Ok(config) => Ok(ai::test_connection(config).await),
        Err(error) => Ok(
            json!({"status":"error","message": if error == "invalid" { "invalid-config" } else { "secure-storage" }}),
        ),
    }
}

async fn execute_ai_note(
    window: WebviewWindow,
    state: State<'_, AppState>,
    note_id: String,
    operation: ai::Operation,
    legacy_polish: bool,
) -> Result<Value, String> {
    note_windows::guard(&window, &state)?;
    state
        .windows
        .lock()
        .map_err(|_| "WINDOW_UNAVAILABLE")?
        .authorize(window.label(), &note_id, true)?;
    if state.ai_busy.swap(true, Ordering::SeqCst) {
        return Ok(json!({"status":"error","message":"busy"}));
    }
    let _busy = AiBusyGuard(&state.ai_busy);
    let content = {
        let store = state.store.lock().map_err(|_| "LOCAL_SAVE_FAILED")?;
        let Some(note) = store.notes.iter().find(|note| note["id"] == note_id) else {
            return Ok(json!({"status":"error","message":"note-missing"}));
        };
        note["content"].as_str().unwrap_or_default().to_string()
    };
    if let Err(message) = ai::validate_content(&content) {
        return Ok(json!({"status":"error","message":message}));
    }
    let config = state
        .ai_configs
        .lock()
        .map_err(|_| "AI_CONFIG_UNAVAILABLE")?
        .credentials()?;
    let Some(config) = config else {
        return Ok(json!({"status":"not-configured"}));
    };
    Ok(if legacy_polish {
        ai::polish(config, content).await
    } else {
        ai::transform(config, content, operation).await
    })
}

#[tauri::command]
async fn polish_note(
    window: WebviewWindow,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Value, String> {
    execute_ai_note(window, state, note_id, ai::Operation::Polish, true).await
}

#[tauri::command]
async fn ai_note(
    window: WebviewWindow,
    state: State<'_, AppState>,
    note_id: String,
    operation: ai::Operation,
) -> Result<Value, String> {
    execute_ai_note(window, state, note_id, operation, false).await
}

#[tauri::command]
fn list_shortcuts(
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<Vec<ShortcutConfig>, String> {
    guard(&window)?;
    Ok(state
        .shortcuts
        .lock()
        .map_err(|_| "SHORTCUT_UNAVAILABLE")?
        .clone())
}
#[tauri::command]
fn save_shortcuts(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
    shortcuts: Vec<ShortcutConfig>,
) -> Result<Value, String> {
    guard(&window)?;
    let mut current = state.shortcuts.lock().map_err(|_| "SHORTCUT_UNAVAILABLE")?;
    if !valid_shortcuts(&shortcuts) {
        return Ok(json!({"status":"invalid","shortcuts":*current}));
    }
    if register_shortcuts(&app, &shortcuts).is_err() {
        let _ = register_shortcuts(&app, &current);
        return Ok(json!({"status":"conflict","shortcuts":*current}));
    }
    let path = state
        .store
        .lock()
        .map_err(|_| "LOCAL_SAVE_FAILED")?
        .root
        .join("shortcuts.json");
    if storage::atomic_json(&path, &shortcuts).is_err() {
        let _ = register_shortcuts(&app, &current);
        return Err("LOCAL_SAVE_FAILED".into());
    }
    *current = shortcuts;
    Ok(json!({"status":"saved","shortcuts":*current}))
}
#[tauri::command]
fn set_pinned_window(window: WebviewWindow, pinned: bool) -> Result<bool, String> {
    note_windows::guard(&window, &window.state::<AppState>())?;
    window
        .set_always_on_top(pinned)
        .map_err(|_| "WINDOW_UNAVAILABLE")?;
    #[cfg(target_os = "macos")]
    window
        .set_visible_on_all_workspaces(pinned)
        .map_err(|_| "WINDOW_UNAVAILABLE")?;
    Ok(pinned)
}
#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    note_windows::guard(&window, &window.state::<AppState>())?;
    window.minimize().map_err(|_| "WINDOW_UNAVAILABLE".into())
}
#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    guard(&window)?;
    window.hide().map_err(|_| "WINDOW_UNAVAILABLE".into())
}
#[tauri::command]
fn start_dragging(window: WebviewWindow) -> Result<(), String> {
    note_windows::guard(&window, &window.state::<AppState>())?;
    window
        .start_dragging()
        .map_err(|_| "WINDOW_UNAVAILABLE".into())
}
#[tauri::command]
fn ready_window(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    note_windows::guard(&window, &state)?;
    if window.label() != "main" {
        state
            .windows
            .lock()
            .map_err(|_| "WINDOW_UNAVAILABLE")?
            .ready
            .insert(window.label().into());
        note_windows::notify_windows(&app);
        note_windows::focus(&window)?;
        #[cfg(debug_assertions)]
        if std::env::var_os("DESK_TABS_DEV_DATA_DIR").is_some()
            && std::env::var("DESK_TABS_DEV_WINDOW_SMOKE").is_ok()
        {
            let phase = if std::env::var("DESK_TABS_DEV_WINDOW_SMOKE").as_deref() == Ok("2") {
                2
            } else {
                1
            };
            window
                .eval(&format!(
                    "window.__qaWindowPhase = {phase}; {}",
                    include_str!("../tests/independent-window-smoke.js")
                ))
                .map_err(|_| "QA_DRIVER_FAILED")?;
        }
        return Ok(());
    }
    if !state.ready.swap(true, Ordering::SeqCst) {
        reveal(&window)?;
        let restore: Vec<String> = state
            .windows
            .lock()
            .map_err(|_| "WINDOW_UNAVAILABLE")?
            .layouts
            .iter()
            .filter(|(_, layout)| layout.open)
            .map(|(id, _)| id.clone())
            .collect();
        for id in restore {
            if note_windows::open(&app, &id).is_err() {
                let _ = note_windows::send(&app, "main", "window:restore-failed", ());
            }
        }
        #[cfg(debug_assertions)]
        if std::env::var_os("DESK_TABS_DEV_DATA_DIR").is_some()
            && std::env::var("DESK_TABS_DEV_WINDOW_SMOKE").is_ok()
        {
            let phase = if std::env::var("DESK_TABS_DEV_WINDOW_SMOKE").as_deref() == Ok("2") {
                2
            } else {
                1
            };
            window
                .eval(&format!(
                    "window.__qaWindowPhase = {phase}; {}",
                    include_str!("../tests/independent-window-smoke.js")
                ))
                .map_err(|_| "QA_DRIVER_FAILED")?;
        }
        #[cfg(debug_assertions)]
        if std::env::var_os("DESK_TABS_DEV_DATA_DIR").is_some()
            && std::env::var("DESK_TABS_DEV_SMOKE").as_deref() == Ok("1")
        {
            window
                .eval(include_str!("../tests/desktop-smoke.js"))
                .map_err(|_| "QA_DRIVER_FAILED")?;
        }
    }
    Ok(())
}

#[tauri::command]
fn get_window_context(window: WebviewWindow, state: State<AppState>) -> Result<Value, String> {
    note_windows::guard(&window, &state)?;
    state
        .windows
        .lock()
        .map_err(|_| "WINDOW_UNAVAILABLE")?
        .context(window.label())
}
#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    note_windows::guard(&window, &window.state::<AppState>())?;
    if title.chars().count() > 256 {
        return Err("INVALID_WINDOW_TITLE".into());
    }
    window
        .set_title(&title)
        .map_err(|_| "WINDOW_UNAVAILABLE".into())
}
#[tauri::command]
fn open_note_window(window: WebviewWindow, app: AppHandle, note_id: String) -> Result<(), String> {
    guard(&window)?;
    note_windows::open(&app, &note_id)
}
#[tauri::command]
fn focus_note_window(window: WebviewWindow, app: AppHandle, note_id: String) -> Result<(), String> {
    guard(&window)?;
    let state = app.state::<AppState>();
    let owner = state
        .windows
        .lock()
        .map_err(|_| "WINDOW_UNAVAILABLE")?
        .owner(&note_id)
        .map(str::to_owned)
        .ok_or("WINDOW_UNAVAILABLE")?;
    note_windows::focus(&app.get_webview_window(&owner).ok_or("WINDOW_UNAVAILABLE")?)
}
#[tauri::command]
fn open_main_window(window: WebviewWindow, app: AppHandle, settings: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    note_windows::guard(&window, &state)?;
    let id = state
        .windows
        .lock()
        .map_err(|_| "WINDOW_UNAVAILABLE")?
        .note_for(window.label())?
        .map(str::to_owned);
    let main = app.get_webview_window("main").ok_or("WINDOW_UNAVAILABLE")?;
    reveal(&main)?;
    if settings {
        note_windows::send(&app, "main", "settings:open", ())?;
    } else if let Some(id) = id {
        note_windows::send(&app, "main", "note:activate", id)?;
    }
    Ok(())
}
#[tauri::command]
fn close_note_window(
    window: WebviewWindow,
    app: AppHandle,
    saved: bool,
    return_to_main: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    note_windows::guard(&window, &state)?;
    if window.label() == "main" || state.exit_pending.load(Ordering::SeqCst) {
        return Err("WINDOW_UNAVAILABLE".into());
    }
    let mut registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let id = registry
        .note_for(window.label())?
        .ok_or("WINDOW_UNAVAILABLE")?
        .to_string();
    let sender = registry.pending_deletes.remove(window.label());
    if !saved {
        if let Some(sender) = sender {
            let _ = sender.send(Err("LOCAL_SAVE_FAILED".into()));
        }
        return Ok(());
    }
    let deleting = sender.is_some();
    let result = (|| {
        let mut layout = note_windows::capture(&window, registry.layouts.get(&id))?;
        layout.open = false;
        let previous = registry.layouts.insert(id.clone(), layout);
        if let Err(error) = registry.persist() {
            if let Some(previous) = previous {
                registry.layouts.insert(id.clone(), previous);
            }
            return Err(error);
        }
        if deleting {
            state
                .store
                .lock()
                .map_err(|_| "LOCAL_SAVE_FAILED")?
                .delete(&id)?;
        }
        registry.bindings.remove(window.label());
        registry.ready.remove(window.label());
        registry.imports.remove(window.label());
        Ok(())
    })();
    if let Some(sender) = sender {
        let _ = sender.send(result.clone());
    }
    drop(registry);
    result?;
    window.destroy().map_err(|_| "WINDOW_UNAVAILABLE")?;
    note_windows::notify_windows(&app);
    if return_to_main && !deleting {
        let main = app.get_webview_window("main").ok_or("WINDOW_UNAVAILABLE")?;
        reveal(&main)?;
        note_windows::send(&app, "main", "note:activate", id)?;
    }
    Ok(())
}

#[tauri::command]
fn sync_begin(
    window: WebviewWindow,
    state: State<AppState>,
    note: Value,
    provider: String,
) -> Result<Value, String> {
    note_windows::guard(&window, &state)?;
    let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let result = |status: &str, message: &str| json!({"status":"result","result":{"status":status,"provider":provider,"message":message}});
    if !is_provider(&provider) {
        return Ok(result("error", "INVALID_PROVIDER"));
    }
    let Some(id) = note["id"].as_str().filter(|s| !s.is_empty()) else {
        return Ok(result("error", "INVALID_NOTE"));
    };
    registry.authorize(window.label(), id, true)?;
    if !note["content"].is_string() || !note["attachments"].is_array() {
        return Ok(result("error", "INVALID_NOTE"));
    }
    let mut sessions = state.sessions.lock().map_err(|_| "SYNC_BUSY")?;
    sessions.retain(|_, s| s.touched.elapsed().as_secs() < 300);
    if !sessions.is_empty() {
        return Ok(result("error", "busy"));
    }
    let config = state
        .configs
        .lock()
        .map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?
        .credentials(&provider)?;
    let Some(config) = config else {
        return Ok(result("not-configured", ""));
    };
    if provider == "notion" {
        return Ok(result("not-implemented", ""));
    }
    let mut store = state.store.lock().map_err(|_| "LOCAL_SAVE_FAILED")?;
    let mut snapshot = note.clone();
    if let Some(stored) = store.notes.iter().find(|n| n["id"] == id) {
        for key in ["feishu", "feishuTargets"] {
            snapshot.as_object_mut().unwrap().remove(key);
            if let Some(value) = stored.get(key) {
                snapshot[key] = value.clone();
            }
        }
    } else {
        snapshot = store.save(snapshot)?;
    }
    let job_id = uuid::Uuid::new_v4().to_string();
    let mut session = sync::new_session(&snapshot, config.clone());
    session.owner_window = window.label().into();
    sessions.insert(job_id.clone(), session);
    Ok(
        json!({"status":"ready","jobId":job_id,"note":snapshot,"config":public_config("feishu", &config)}),
    )
}
#[tauri::command]
fn sync_checkpoint(
    window: WebviewWindow,
    state: State<AppState>,
    job_id: String,
    document: Value,
) -> Result<(), String> {
    note_windows::guard(&window, &state)?;
    let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let mut sessions = state.sessions.lock().map_err(|_| "SYNC_BUSY")?;
    let session = sessions.get_mut(&job_id).ok_or("SYNC_JOB_MISSING")?;
    if session.owner_window != window.label() {
        return Err("UNTRUSTED_WINDOW".into());
    }
    registry.authorize(window.label(), &session.note_id, true)?;
    if document["appId"] != session.credentials["appId"]
        || document["targetKey"] != sync::target_key(&session.credentials)
        || document
            .get("documentId")
            .is_some_and(|id| !id.as_str().is_some_and(|s| session.documents.contains(s)))
    {
        return Err("INVALID_SYNC_CHECKPOINT".into());
    }
    session.touched = tokio::time::Instant::now();
    let mut store = state.store.lock().map_err(|_| "LOCAL_SAVE_FAILED")?;
    let mut next = store.notes.clone();
    let note = next
        .iter_mut()
        .find(|n| n["id"] == session.note_id)
        .ok_or("INVALID_NOTE")?;
    note["feishu"] = document.clone();
    if !note["feishuTargets"].is_object() {
        note["feishuTargets"] = json!({});
    }
    note["feishuTargets"][sync::target_key(&session.credentials)] = document;
    store.replace(next)
}
#[tauri::command]
fn sync_finish(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
    job_id: String,
    mut result: Value,
) -> Result<Value, String> {
    note_windows::guard(&window, &state)?;
    let registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let mut sessions = state.sessions.lock().map_err(|_| "SYNC_BUSY")?;
    let session = sessions.get(&job_id).ok_or("SYNC_JOB_MISSING")?;
    if session.owner_window != window.label() {
        return Err("UNTRUSTED_WINDOW".into());
    }
    registry.authorize(window.label(), &session.note_id, true)?;
    let session = sessions.remove(&job_id).unwrap();
    let mut store = state.store.lock().map_err(|_| "LOCAL_SAVE_FAILED")?;
    let mut next = store.notes.clone();
    let note = next
        .iter_mut()
        .find(|n| n["id"] == session.note_id)
        .ok_or("INVALID_NOTE")?;
    let synced = result["status"] == "synced";
    note["syncState"] = json!(if note["content"] != session.content {
        "local"
    } else if synced {
        "synced"
    } else {
        "error"
    });
    if synced {
        result["note"] = note.clone();
    }
    let saved = note.clone();
    store.replace(next)?;
    drop(store);
    drop(sessions);
    drop(registry);
    note_windows::notify_note(&app, &saved, window.label());
    Ok(result)
}
#[tauri::command]
async fn feishu_request(
    window: WebviewWindow,
    state: State<'_, AppState>,
    job_id: String,
    path: String,
    method: String,
    body: Value,
) -> Result<Value, FeishuError> {
    note_windows::guard(&window, &state).map_err(|_| FeishuError::new("permission", false))?;
    let credentials = {
        let registry = state
            .windows
            .lock()
            .map_err(|_| FeishuError::new("permission", false))?;
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| FeishuError::new("busy", false))?;
        let session = sessions
            .get_mut(&job_id)
            .ok_or_else(|| FeishuError::new("permission", false))?;
        if session.owner_window != window.label()
            || registry
                .authorize(window.label(), &session.note_id, true)
                .is_err()
        {
            return Err(FeishuError::new("permission", false));
        }
        if !sync::allowed_request(session, &path, &method, &body) {
            return Err(FeishuError::new("permission", false));
        }
        session.touched = tokio::time::Instant::now();
        session.credentials.clone()
    };
    let response = state
        .network
        .lock()
        .await
        .request(&credentials, &path, &method, &body)
        .await?;
    if path == "/docx/v1/documents" || path.starts_with("/wiki/v2/spaces/get_node?") {
        let id = if path == "/docx/v1/documents" {
            response["data"]["document"]["document_id"].as_str()
        } else if response["data"]["node"]["obj_type"] == "docx" {
            response["data"]["node"]["obj_token"].as_str()
        } else {
            None
        };
        if let Some(id) = id.filter(|s| sync::is_id(s)) {
            if let Ok(mut sessions) = state.sessions.lock() {
                if let Some(session) = sessions.get_mut(&job_id) {
                    session.documents.insert(id.into());
                }
            }
        }
    }
    Ok(response)
}

pub fn run() {
    let mut application = tauri::Builder::default();
    // The isolated debug window smoke test must not attach to an already
    // running installed app through the single-instance plugin.
    #[cfg(debug_assertions)]
    let window_smoke = std::env::var_os("DESK_TABS_DEV_WINDOW_SMOKE").is_some();
    #[cfg(not(debug_assertions))]
    let window_smoke = false;
    if !window_smoke {
        application = application.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = reveal(&window);
            }
        }));
    }
    let application = application
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            list_notes,
            save_note,
            delete_note,
            get_window_context,
            set_window_title,
            open_note_window,
            focus_note_window,
            open_main_window,
            close_note_window,
            pick_files,
            open_attachment,
            open_external_link,
            list_sync_configs,
            save_sync_config,
            clear_sync_config,
            get_ai_config,
            save_ai_config,
            clear_ai_config,
            test_ai_connection,
            polish_note,
            ai_note,
            list_shortcuts,
            save_shortcuts,
            set_pinned_window,
            minimize_window,
            hide_window,
            start_dragging,
            ready_window,
            complete_exit,
            request_exit,
            sync_begin,
            sync_checkpoint,
            sync_finish,
            feishu_request
        ])
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            // Development QA can use isolated data without touching real notes.
            #[cfg(debug_assertions)]
            let root = match std::env::var_os("DESK_TABS_DEV_DATA_DIR") {
                Some(path) => {
                    let path = std::path::PathBuf::from(path);
                    if !path.is_absolute() {
                        return Err("INVALID_DEV_DATA_DIR".into());
                    }
                    path
                }
                None => root,
            };
            let legacy = dirs::data_dir().map(|path| path.join("desk-tabs"));
            #[cfg(debug_assertions)]
            let legacy = if std::env::var_os("DESK_TABS_DEV_DATA_DIR").is_some() {
                None
            } else {
                legacy
            };
            let store = Store::load(root, legacy.as_deref())?;
            let shortcuts =
                storage::read_json::<Vec<ShortcutConfig>>(&store.root.join("shortcuts.json"))?
                    .filter(|configs| valid_shortcuts(configs))
                    .unwrap_or_else(defaults);
            let windows = note_windows::Registry::load(&store.root)?;
            app.manage(AppState {
                store: Mutex::new(store),
                windows: Mutex::new(windows),
                configs: Mutex::new(ConfigStore::system()),
                ai_configs: Mutex::new(ai::ConfigStore::system()),
                ai_busy: AtomicBool::new(false),
                shortcuts: Mutex::new(shortcuts.clone()),
                sessions: Mutex::new(HashMap::new()),
                network: tokio::sync::Mutex::new(Network::new()?),
                ready: AtomicBool::new(false),
                exit_pending: AtomicBool::new(false),
                exit_allowed: AtomicBool::new(false),
            });
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .shadow(false)
                    .on_navigation(trusted_url)
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()?;
            let window_for_close = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_for_close.hide();
                }
            });
            if register_shortcuts(app.handle(), &shortcuts).is_err() {
                let fallback = defaults();
                let _ = register_shortcuts(app.handle(), &fallback);
                *app.state::<AppState>().shortcuts.lock().unwrap() = fallback;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start 贴贴便签");
    application.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            let state = app.state::<AppState>();
            if state.ready.load(Ordering::SeqCst) && !state.exit_allowed.load(Ordering::SeqCst) {
                api.prevent_exit();
                if !state.exit_pending.swap(true, Ordering::SeqCst) {
                    let request_id = uuid::Uuid::new_v4().to_string();
                    let participants = {
                        let mut registry = state.windows.lock().unwrap();
                        if !registry.pending_deletes.is_empty()
                            || registry
                                .bindings
                                .keys()
                                .any(|label| !registry.ready.contains(label))
                        {
                            drop(registry);
                            note_windows::cancel_exit(app);
                            return;
                        }
                        let mut waiting: HashSet<String> =
                            registry.bindings.keys().cloned().collect();
                        waiting.insert("main".into());
                        registry.exit = Some(note_windows::ExitSession {
                            id: request_id.clone(),
                            waiting: waiting.clone(),
                        });
                        waiting
                    };
                    for label in participants {
                        if note_windows::send(app, &label, "app:exit-requested", &request_id)
                            .is_err()
                        {
                            note_windows::cancel_exit(app);
                            break;
                        }
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(window) = app.get_webview_window("main") {
                let _ = reveal(&window);
            }
        }
        if let tauri::RunEvent::Exit = event {
            let _ = app.global_shortcut().unregister_all();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_aliases_cannot_register_duplicate_keys() {
        assert!(valid_shortcuts(&defaults()));
        let mut configs = defaults();
        configs[1].accelerator = "CmdOrCtrl+Shift+Space".into();
        assert!(!valid_shortcuts(&configs));
    }
    #[test]
    fn remote_pages_are_not_trusted_even_when_the_window_label_matches() {
        assert!(trusted_url(
            &"tauri://localhost/index.html".parse().unwrap()
        ));
        assert!(trusted_url(&"http://tauri.localhost/".parse().unwrap()));
        for url in [
            "https://feishu.cn/",
            "https://127.0.0.1:5173/",
            "http://127.0.0.1:5174/",
            "http://tauri.localhost.evil.test/",
        ] {
            assert!(!trusted_url(&url.parse().unwrap()));
        }
    }
}
