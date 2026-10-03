use crate::{storage, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};
use tokio::sync::oneshot;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    pub pinned: bool,
    pub open: bool,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            x: 100,
            y: 100,
            width: 440.0,
            height: 390.0,
            pinned: false,
            open: false,
        }
    }
}

pub struct ExitSession {
    pub id: String,
    pub waiting: HashSet<String>,
}

pub struct Registry {
    pub bindings: HashMap<String, String>,
    pub ready: HashSet<String>,
    pub imports: HashMap<String, HashSet<String>>,
    pub layouts: HashMap<String, Layout>,
    pub pending_deletes: HashMap<String, oneshot::Sender<Result<(), String>>>,
    pub exit: Option<ExitSession>,
    path: PathBuf,
}
impl Registry {
    pub fn load(root: &std::path::Path) -> Result<Self, String> {
        let path = root.join("note-windows.json");
        let layouts: HashMap<String, Layout> = storage::read_json(&path)?.unwrap_or_default();
        Ok(Self {
            bindings: HashMap::new(),
            ready: HashSet::new(),
            imports: HashMap::new(),
            layouts,
            pending_deletes: HashMap::new(),
            exit: None,
            path,
        })
    }
    pub fn persist(&self) -> Result<(), String> {
        storage::atomic_json(&self.path, &self.layouts)
    }
    pub fn owner(&self, note_id: &str) -> Option<&str> {
        self.bindings
            .iter()
            .find_map(|(label, id)| (id == note_id).then_some(label.as_str()))
    }
    pub fn note_for(&self, label: &str) -> Result<Option<&str>, String> {
        if label == "main" {
            return Ok(None);
        }
        self.bindings
            .get(label)
            .map(|id| Some(id.as_str()))
            .ok_or_else(|| "UNTRUSTED_WINDOW".into())
    }
    pub fn authorize(&self, label: &str, note_id: &str, write: bool) -> Result<(), String> {
        match self.note_for(label)? {
            Some(id) if id != note_id => Err("UNTRUSTED_NOTE".into()),
            None if write && self.owner(note_id).is_some() => Err("NOTE_IN_OTHER_WINDOW".into()),
            _ => Ok(()),
        }
    }
    pub fn authorize_attachments(
        &self,
        label: &str,
        note: &Value,
        previous: Option<&Value>,
    ) -> Result<(), String> {
        if label == "main" {
            return Ok(());
        }
        let existing: HashSet<&str> = previous
            .and_then(|note| note["attachments"].as_array())
            .into_iter()
            .flatten()
            .filter_map(|attachment| attachment["storedPath"].as_str())
            .collect();
        for attachment in note["attachments"].as_array().ok_or("INVALID_NOTE")? {
            let path = attachment["storedPath"]
                .as_str()
                .ok_or("INVALID_ATTACHMENT_PATH")?;
            if !existing.contains(path)
                && !self
                    .imports
                    .get(label)
                    .is_some_and(|paths| paths.contains(path))
            {
                return Err("INVALID_ATTACHMENT_PATH".into());
            }
        }
        Ok(())
    }
    pub fn context(&self, label: &str) -> Result<Value, String> {
        let note_id = self.note_for(label)?;
        let mut open: Vec<&String> = if label == "main" {
            self.bindings.values().collect()
        } else {
            vec![]
        };
        open.sort();
        let ready: Vec<&String> = if label == "main" {
            self.bindings
                .iter()
                .filter(|(label, _)| self.ready.contains(*label))
                .map(|(_, id)| id)
                .collect()
        } else {
            vec![]
        };
        Ok(
            json!({"noteId": note_id, "openNoteIds": open, "readyNoteIds": ready,
            "pinned": note_id.and_then(|id| self.layouts.get(id)).is_some_and(|layout| layout.pinned)}),
        )
    }
    pub fn acknowledge_exit(&mut self, request_id: &str, label: &str) -> Result<bool, String> {
        let session = self.exit.as_mut().ok_or("EXIT_NOT_REQUESTED")?;
        if session.id != request_id || !session.waiting.remove(label) {
            return Err("EXIT_NOT_REQUESTED".into());
        }
        Ok(session.waiting.is_empty())
    }
}

pub fn guard(window: &WebviewWindow, state: &AppState) -> Result<(), String> {
    if !window.url().is_ok_and(|url| crate::trusted_url(&url)) {
        return Err("UNTRUSTED_WINDOW".into());
    }
    state
        .windows
        .lock()
        .map_err(|_| "WINDOW_UNAVAILABLE")?
        .note_for(window.label())?;
    Ok(())
}
pub fn focus(window: &WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|_| "WINDOW_UNAVAILABLE")?;
    window.show().map_err(|_| "WINDOW_UNAVAILABLE")?;
    window.set_focus().map_err(|_| "WINDOW_UNAVAILABLE".into())
}
// Tauri global listeners can receive emit_to events for another target. A
// window-local DOM event keeps both content and lifecycle requests confined
// to the actual WebView, without granting a general renderer event transport.
pub fn send<T: Serialize>(
    app: &AppHandle,
    label: &str,
    event: &str,
    payload: T,
) -> Result<(), String> {
    let window = app.get_webview_window(label).ok_or("WINDOW_UNAVAILABLE")?;
    let name =
        serde_json::to_string(&format!("desk-tabs:{event}")).map_err(|_| "WINDOW_UNAVAILABLE")?;
    let detail = serde_json::to_string(&payload).map_err(|_| "WINDOW_UNAVAILABLE")?;
    window
        .eval(&format!(
            "window.dispatchEvent(new CustomEvent({name}, {{detail:{detail}}}));"
        ))
        .map_err(|_| "WINDOW_UNAVAILABLE".into())
}
pub fn notify_windows(app: &AppHandle) {
    if let Ok(registry) = app.state::<AppState>().windows.lock() {
        if let Ok(context) = registry.context("main") {
            let _ = send(app, "main", "windows:changed", context);
        }
    }
}
pub fn notify_note(app: &AppHandle, note: &Value, source: &str) {
    // Only the library and this note's owner may receive its content.
    let payload = json!({"note":note,"sourceWindow":source});
    let _ = send(app, "main", "notes:changed", &payload);
    if let Ok(registry) = app.state::<AppState>().windows.lock() {
        if let Some(owner) = note["id"].as_str().and_then(|id| registry.owner(id)) {
            let _ = send(app, owner, "notes:changed", &payload);
        }
    }
}
pub fn capture(window: &WebviewWindow, previous: Option<&Layout>) -> Result<Layout, String> {
    let mut layout = previous.cloned().unwrap_or_default();
    let scale = window.scale_factor().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let position = window.outer_position().map_err(|_| "WINDOW_UNAVAILABLE")?;
    let size = window.inner_size().map_err(|_| "WINDOW_UNAVAILABLE")?;
    layout.x = position.x;
    layout.y = position.y;
    layout.width = size.width as f64 / scale;
    layout.height = size.height as f64 / scale;
    layout.pinned = window
        .is_always_on_top()
        .map_err(|_| "WINDOW_UNAVAILABLE")?;
    Ok(layout)
}

pub fn fit(layout: &mut Layout, left: i32, top: i32, width: u32, height: u32, scale: f64) {
    layout.width = if layout.width.is_finite() {
        layout.width.clamp(320.0, 760.0)
    } else {
        440.0
    };
    layout.height = if layout.height.is_finite() {
        layout.height.clamp(260.0, 860.0)
    } else {
        390.0
    };
    layout.width = layout.width.min(width as f64 / scale);
    layout.height = layout.height.min(height as f64 / scale);
    let right = left
        .saturating_add(width as i32)
        .saturating_sub((layout.width * scale).ceil() as i32)
        .max(left);
    let bottom = top
        .saturating_add(height as i32)
        .saturating_sub((layout.height * scale).ceil() as i32)
        .max(top);
    layout.x = layout.x.clamp(left, right);
    layout.y = layout.y.clamp(top, bottom);
}

pub fn open(app: &AppHandle, note_id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.exit_pending.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("EXIT_PENDING".into());
    }
    let label;
    let mut layout;
    {
        let mut registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
        if let Some(owner) = registry.owner(note_id) {
            return focus(&app.get_webview_window(owner).ok_or("WINDOW_UNAVAILABLE")?);
        }
        let store = state.store.lock().map_err(|_| "LOCAL_READ_FAILED")?;
        if !store.notes.iter().any(|note| note["id"] == note_id) {
            return Err("NOTE_MISSING".into());
        }
        label = format!("note-{}", uuid::Uuid::new_v4());
        layout = registry.layouts.get(note_id).cloned().unwrap_or_default();
        if !registry.layouts.contains_key(note_id) {
            if let Some(main) = app.get_webview_window("main") {
                if let Ok(position) = main.outer_position() {
                    layout.x = position.x + 36;
                    layout.y = position.y + 36;
                }
            }
        }
        registry.bindings.insert(label.clone(), note_id.into());
    }
    let created = (|| {
        let main = app.get_webview_window("main").ok_or("WINDOW_UNAVAILABLE")?;
        let monitors = main
            .available_monitors()
            .map_err(|_| "WINDOW_UNAVAILABLE")?;
        let monitor = monitors
            .iter()
            .find(|monitor| {
                let area = monitor.work_area();
                layout.x >= area.position.x
                    && layout.y >= area.position.y
                    && layout.x < area.position.x + area.size.width as i32
                    && layout.y < area.position.y + area.size.height as i32
            })
            .cloned()
            .or_else(|| main.current_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            fit(
                &mut layout,
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
                monitor.scale_factor(),
            );
        }
        let window = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("贴贴便签")
        .inner_size(layout.width, layout.height)
        .min_inner_size(320.0, 260.0)
        .max_inner_size(760.0, 860.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .visible(false)
        .resizable(true)
        .disable_drag_drop_handler()
        .always_on_top(layout.pinned)
        .on_navigation(crate::trusted_url)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|_| "WINDOW_UNAVAILABLE")?;
        window
            .set_position(PhysicalPosition::new(layout.x, layout.y))
            .map_err(|_| "WINDOW_UNAVAILABLE")?;
        #[cfg(target_os = "macos")]
        window
            .set_visible_on_all_workspaces(layout.pinned)
            .map_err(|_| "WINDOW_UNAVAILABLE")?;
        let app_for_event = app.clone();
        let label_for_event = label.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = send(
                    &app_for_event,
                    &label_for_event,
                    "window:close-requested",
                    (),
                );
            }
            if let tauri::WindowEvent::Destroyed = event {
                let state = app_for_event.state::<AppState>();
                if state.exit_allowed.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                let unexpected = {
                    let mut registry = state.windows.lock().unwrap();
                    registry.ready.remove(&label_for_event);
                    registry.imports.remove(&label_for_event);
                    if let Some(id) = registry.bindings.remove(&label_for_event) {
                        if let Some(layout) = registry.layouts.get_mut(&id) {
                            layout.open = false;
                        }
                        let _ = registry.persist();
                        if let Some(sender) = registry.pending_deletes.remove(&label_for_event) {
                            let _ = sender.send(Err("WINDOW_UNAVAILABLE".into()));
                        }
                        true
                    } else {
                        false
                    }
                };
                if unexpected {
                    if state.exit_pending.load(std::sync::atomic::Ordering::SeqCst) {
                        cancel_exit(&app_for_event);
                    }
                    notify_windows(&app_for_event);
                }
            }
        });
        layout.open = true;
        {
            let mut registry = state.windows.lock().map_err(|_| "WINDOW_UNAVAILABLE")?;
            registry.layouts.insert(note_id.into(), layout.clone());
            registry.persist()?;
        }
        Ok(())
    })();
    if created.is_err() {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        state
            .windows
            .lock()
            .map_err(|_| "WINDOW_UNAVAILABLE")?
            .bindings
            .remove(&label);
    }
    notify_windows(app);
    created
}

pub fn cancel_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut registry) = state.windows.lock() {
        registry.exit = None;
    }
    state
        .exit_pending
        .store(false, std::sync::atomic::Ordering::SeqCst);
    for label in app.webview_windows().keys() {
        let _ = send(app, label, "app:exit-cancelled", ());
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = crate::reveal(&main);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_registered_windows_can_edit_their_assigned_note() {
        let root = tempfile::tempdir().unwrap();
        let mut registry = Registry::load(root.path()).unwrap();
        registry.bindings.insert("note-owned".into(), "one".into());
        assert!(registry.authorize("main", "one", false).is_ok());
        assert!(registry.authorize("main", "one", true).is_err());
        assert!(registry.authorize("main", "two", true).is_ok());
        assert!(registry.authorize("note-owned", "one", true).is_ok());
        assert!(registry.authorize("note-owned", "two", false).is_err());
        assert!(registry.authorize("note-forged", "one", true).is_err());
        registry.bindings.remove("note-owned");
        assert!(registry.authorize("note-owned", "one", true).is_err());
        assert!(registry.authorize("main", "one", true).is_ok());
    }
    #[test]
    fn layout_survives_restart_without_restoring_closed_windows() {
        let root = tempfile::tempdir().unwrap();
        let mut registry = Registry::load(root.path()).unwrap();
        registry.layouts.insert(
            "open".into(),
            Layout {
                open: true,
                pinned: true,
                x: -800,
                ..Layout::default()
            },
        );
        registry.layouts.insert("closed".into(), Layout::default());
        registry.persist().unwrap();
        let restored = Registry::load(root.path()).unwrap();
        assert!(restored.layouts["open"].open);
        assert!(restored.layouts["open"].pinned);
        assert!(!restored.layouts["closed"].open);
        assert!(restored.bindings.is_empty());
    }
    #[test]
    fn restoration_clamps_to_work_area_including_negative_monitor_origins() {
        let mut layout = Layout {
            x: 9999,
            y: -9999,
            width: 9999.0,
            height: 9999.0,
            ..Layout::default()
        };
        fit(&mut layout, -1920, 30, 1920, 1050, 1.0);
        assert_eq!(
            (layout.x, layout.y, layout.width, layout.height),
            (-760, 30, 760.0, 860.0)
        );
    }
    #[test]
    fn exit_requires_every_window_and_rejects_old_or_duplicate_confirmations() {
        let root = tempfile::tempdir().unwrap();
        let mut registry = Registry::load(root.path()).unwrap();
        registry.exit = Some(ExitSession {
            id: "new".into(),
            waiting: HashSet::from(["main".into(), "note-one".into()]),
        });
        assert!(registry.acknowledge_exit("old", "main").is_err());
        assert!(!registry.acknowledge_exit("new", "main").unwrap());
        assert!(registry.acknowledge_exit("new", "main").is_err());
        assert!(registry.acknowledge_exit("new", "note-one").unwrap());
    }
    #[test]
    fn a_note_window_can_only_reuse_its_existing_or_freshly_imported_attachments() {
        let root = tempfile::tempdir().unwrap();
        let mut registry = Registry::load(root.path()).unwrap();
        let old = json!({"attachments":[{"storedPath":"owned"}]});
        let imported = json!({"attachments":[{"storedPath":"owned"},{"storedPath":"fresh"}]});
        assert!(registry
            .authorize_attachments("note-one", &old, Some(&old))
            .is_ok());
        assert!(registry
            .authorize_attachments("note-one", &imported, Some(&old))
            .is_err());
        registry
            .imports
            .insert("note-one".into(), HashSet::from(["fresh".into()]));
        assert!(registry
            .authorize_attachments("note-one", &imported, Some(&old))
            .is_ok());
        assert!(registry
            .authorize_attachments("note-two", &imported, Some(&old))
            .is_err());
    }
}
