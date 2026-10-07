use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub note: Value,
    pub created_at: String,
    pub reason: String,
}

pub fn list(root: &Path) -> Result<Vec<Entry>, String> {
    let entries: Vec<Entry> = crate::storage::read_json(&root.join("recovery.json"))?.unwrap_or_default();
    let cutoff = chrono::Utc::now() - chrono::Duration::days(30);
    Ok(entries.into_iter().filter(|entry| chrono::DateTime::parse_from_rfc3339(&entry.created_at).is_ok_and(|date| date >= cutoff)).map(|mut entry| {
        crate::storage::strip_attachment_previews(&mut entry.note); entry
    }).collect())
}

pub fn record(root: &Path, note: &Value, reason: &str) -> Result<Entry, String> {
    let mut entries = list(root)?;
    let mut snapshot = note.clone();
    crate::storage::strip_attachment_previews(&mut snapshot);
    let entry = Entry { id: uuid::Uuid::new_v4().to_string(), note: snapshot, created_at: crate::storage::now(), reason: reason.into() };
    entries.insert(0, entry.clone());
    let mut counts = std::collections::HashMap::<String, usize>::new();
    entries.retain(|entry| {
        if entry.reason == "deleted" { return true; }
        let count = counts.entry(entry.note["id"].as_str().unwrap_or_default().into()).or_default();
        *count += 1;
        *count <= 20
    });
    crate::storage::atomic_json(&root.join("recovery.json"), &entries)?;
    Ok(entry)
}

pub fn metadata(entry: &Entry) -> Value {
    json!({"id":entry.id,"noteId":entry.note["id"],"title":entry.note["content"].as_str().unwrap_or_default().lines().next().unwrap_or_default(),"createdAt":entry.created_at,"reason":entry.reason})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_survive_restart_and_keep_deleted_notes_and_bounded_versions() {
        let temp = tempfile::tempdir().unwrap();
        let note = json!({"id":"a","content":"original","attachments":[]});
        record(temp.path(), &note, "deleted").unwrap();
        for index in 0..25 { record(temp.path(), &json!({"id":"a","content":index.to_string(),"attachments":[]}), "ai-before").unwrap(); }
        let entries = list(temp.path()).unwrap();
        assert_eq!(entries.len(), 21);
        assert_eq!(entries.last().unwrap().note, note);
        assert_eq!(metadata(&entries[0])["reason"], "ai-before");
    }
    #[test]
    fn expired_recovery_is_not_offered_and_corruption_does_not_silently_discard_history() {
        let temp = tempfile::tempdir().unwrap();
        let entries = vec![Entry { id: "old".into(), note: json!({"id":"a"}), reason: "deleted".into(), created_at: "2020-01-01T00:00:00Z".into() }];
        crate::storage::atomic_json(&temp.path().join("recovery.json"), &entries).unwrap();
        assert!(list(temp.path()).unwrap().is_empty());
        std::fs::write(temp.path().join("recovery.json"), "invalid").unwrap();
        assert!(record(temp.path(), &json!({"id":"a"}), "deleted").is_err());
    }

    #[test]
    fn deleted_note_restores_after_reload_and_version_restore_preserves_current_content() {
        let temp = tempfile::tempdir().unwrap();
        crate::storage::atomic_json(&temp.path().join("notes.json"), &Vec::<Value>::new()).unwrap();
        let mut store = crate::storage::Store::load(temp.path().into(), None).unwrap();
        let original = store.save(json!({"id":"a","content":"original","attachments":[],"theme":"sage"})).unwrap();
        store.delete("a").unwrap();
        drop(store);
        let mut store = crate::storage::Store::load(temp.path().into(), None).unwrap();
        let deleted = list(temp.path()).unwrap().remove(0);
        let restored = store.restore_recovery(&deleted.id).unwrap();
        assert_eq!(restored["content"], original["content"]);
        assert_eq!(restored["createdAt"], original["createdAt"]);
        assert!(store.restore_recovery(&deleted.id).is_err());
        let before_ai = record(temp.path(), &restored, "ai-before").unwrap();
        let mut typed = restored.clone(); typed["content"] = json!("later typing"); store.save(typed).unwrap();
        assert_eq!(store.restore_recovery(&before_ai.id).unwrap()["content"], "original");
        assert!(list(temp.path()).unwrap().iter().any(|entry| entry.reason == "restore-before" && entry.note["content"] == "later typing"));
    }

    #[test]
    fn favorite_and_archive_metadata_are_persisted_and_recovery_preserves_attachments() {
        let temp = tempfile::tempdir().unwrap();
        crate::storage::atomic_json(&temp.path().join("notes.json"), &Vec::<Value>::new()).unwrap();
        let mut store = crate::storage::Store::load(temp.path().into(), None).unwrap();
        let path = temp.path().join("attachments").join("fixture.txt"); std::fs::write(&path, "fixture").unwrap();
        let mut note = store.save(json!({"id":"a","content":"original","attachments":[{"id":"file","storedPath":path,"name":"fixture.txt","size":7,"mimeType":"text/plain"}]})).unwrap();
        note["favorite"] = json!(true); note["archived"] = json!(true); store.save(note).unwrap(); store.delete("a").unwrap();
        let entry = list(temp.path()).unwrap().remove(0);
        drop(store);
        let mut store = crate::storage::Store::load(temp.path().into(), None).unwrap();
        let restored = store.restore_recovery(&entry.id).unwrap();
        assert_eq!(restored["favorite"], true); assert_eq!(restored["archived"], true); assert_eq!(restored["attachments"][0]["storedPath"], json!(path));
        assert!(path.exists());
    }
}
