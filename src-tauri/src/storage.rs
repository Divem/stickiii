use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;

fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some(("image/webp", "webp"))
    } else if bytes.starts_with(b"BM") {
        Some(("image/bmp", "bmp"))
    } else {
        None
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn atomic_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("INVALID_DATA_PATH")?;
    fs::create_dir_all(parent).map_err(|_| "LOCAL_SAVE_FAILED")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| "LOCAL_SAVE_FAILED")?;
    {
        let mut writer = BufWriter::new(&mut file);
        serde_json::to_writer(&mut writer, value).map_err(|_| "LOCAL_SAVE_FAILED")?;
        writer.flush().map_err(|_| "LOCAL_SAVE_FAILED")?;
    }
    file.as_file().sync_all().map_err(|_| "LOCAL_SAVE_FAILED")?;
    file.persist(path).map_err(|_| "LOCAL_SAVE_FAILED")?;
    Ok(())
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "INVALID_LOCAL_DATA".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("LOCAL_READ_FAILED".into()),
    }
}

pub fn managed_path(root: &Path, value: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|_| "INVALID_ATTACHMENT_PATH")?;
    let path = fs::canonicalize(value).map_err(|_| "INVALID_ATTACHMENT_PATH")?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("INVALID_ATTACHMENT_PATH".into());
    }
    Ok(path)
}

fn builtin_notes() -> Vec<Value> {
    let now = now();
    vec![
        json!({
            "id": "builtin-product-intro",
            "content": "# 贴贴便签｜产品介绍\n\n贴贴便签是一款从任意窗口快速唤起的本地优先桌面随手记。它把文字、Markdown、图片和文件先放在手边，让你先记下来，再决定是否整理到长期知识库。\n\n## 适合这些场景\n\n- 会议、浏览网页或写代码时，快速记下一闪而过的想法。\n- 收到一段文字、一张图片或一个文件，先和当下的上下文放在一起。\n- 把临时记录继续整理到飞书文档，同时保留一份本地记录。\n\n## 当前能力\n\n- 使用全局快捷键打开可拖动、可缩放的便签窗口。\n- 在同一条记录里编辑 Markdown，并随时切换编辑和预览。\n- 本地自动保存记录和附件；每条便签可以单独选择主题。\n- 配置飞书后手动同步文字和 Markdown，可创建独立文档或追加到指定文档。\n\n## 数据边界\n\n默认情况下，记录和附件只保存在本机。只有你配置飞书并主动点击同步时，当前便签内容才会发送到飞书。\n\n## 联系方式\n\n如果你有问题、建议或合作想法，欢迎邮件联系：**imyuanwen@gmail.com**。",
            "attachments": [],
            "createdAt": now,
            "updatedAt": now,
            "syncState": "local",
            "theme": "paper"
        }),
        json!({
            "id": "builtin-how-to-use",
            "content": "# 贴贴便签｜使用方法\n\n## 1. 快速记录\n\n1. 在任意应用中按 `Command/Ctrl + Shift + Space` 唤起贴贴便签。\n2. 直接在正文区域输入内容，停止输入后会自动保存。\n3. 再次按快捷键可以隐藏窗口；关闭窗口也只会隐藏，不会退出应用。\n\n## 2. 编辑和整理\n\n- 第一行会作为便签标题显示，正文支持 Markdown。\n- 点击顶部的预览按钮查看排版，再切回编辑继续修改。\n- 点击加号新建便签，点击便签列表或页码在记录之间切换。\n- 使用主题和透明度设置，让便签适合你的桌面。\n\n## 3. 添加附件\n\n点击底部的附件按钮，从系统文件选择器添加图片或文件。附件会先复制到贴贴便签的应用数据目录，图片可以直接预览，其他文件可以交给系统打开。\n\n## 4. 同步到飞书\n\n1. 打开“设置 → 飞书”，填写 App ID、App Secret 和协作者邮箱。\n2. 选择“每条笔记创建新文档”，或粘贴目标文档链接并选择追加模式。\n3. 回到要同步的便签，点击底部的飞书按钮并确认结果。\n\n同步是手动触发的；本地图片会作为图片块上传，其他文件会作为附件块上传，Markdown 中的网络图片保留为链接。没有配置飞书时，记录仍可正常本地使用。\n\n## 5. 常用快捷键\n\n- `Command/Ctrl + Shift + Space`：唤起 / 隐藏便签\n- `Command/Ctrl + Shift + N`：新建便签\n- `Command/Ctrl + Alt + Left/Right`：上一条 / 下一条便签\n\n快捷键可以在“更多 → 设置 → 全局快捷键”中修改。\n\n## 联系方式\n\n使用中遇到问题或想提出建议，请联系：**imyuanwen@gmail.com**。",
            "attachments": [],
            "createdAt": now,
            "updatedAt": now,
            "syncState": "local",
            "theme": "sage"
        }),
    ]
}

fn normalize_note(note: &mut Value) -> Result<(), String> {
    let object = note.as_object_mut().ok_or("INVALID_NOTE")?;
    if object
        .get("id")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
        || object.get("content").and_then(Value::as_str).is_none()
        || object
            .get("attachments")
            .and_then(Value::as_array)
            .is_none()
    {
        return Err("INVALID_NOTE".into());
    }
    if let Some(title) = object
        .remove("title")
        .and_then(|v| v.as_str().map(str::to_owned))
    {
        if !title.trim().is_empty() && title != "未命名记录" && title != "Untitled note" {
            let content = object["content"].as_str().unwrap();
            object.insert(
                "content".into(),
                json!(if content.is_empty() {
                    title
                } else {
                    format!("{title}\n{content}")
                }),
            );
        }
    }
    if let Some(opacity) = object.get("themeOpacity").and_then(Value::as_f64) {
        object.insert("themeOpacity".into(), json!(opacity.clamp(0.4, 1.0)));
    } else {
        object.remove("themeOpacity");
    }
    if object.get("syncState").and_then(Value::as_str) == Some("syncing") {
        object.insert("syncState".into(), json!("local"));
    }
    Ok(())
}

pub struct Store {
    pub root: PathBuf,
    pub notes: Vec<Value>,
    deleted: HashSet<String>,
}

impl Store {
    pub fn load(root: PathBuf, legacy: Option<&Path>) -> Result<Self, String> {
        fs::create_dir_all(root.join("attachments")).map_err(|_| "LOCAL_SAVE_FAILED")?;
        let notes_path = root.join("notes.json");
        let had_notes_file = notes_path.exists();
        if !had_notes_file {
            if let Some(legacy) = legacy {
                if let Some(mut notes) = read_json::<Vec<Value>>(&legacy.join("notes.json"))? {
                    let mut copied = std::collections::HashMap::<PathBuf, PathBuf>::new();
                    for note in &mut notes {
                        normalize_note(note)?;
                        for attachment in
                            note["attachments"].as_array_mut().ok_or("INVALID_NOTE")?
                        {
                            let old_path = attachment["storedPath"]
                                .as_str()
                                .ok_or("INVALID_ATTACHMENT_PATH")?;
                            let source = managed_path(&legacy.join("attachments"), old_path)?;
                            let destination = if let Some(path) = copied.get(&source) {
                                path.clone()
                            } else {
                                let path = root
                                    .join("attachments")
                                    .join(source.file_name().ok_or("INVALID_ATTACHMENT_PATH")?);
                                fs::copy(&source, &path).map_err(|_| "ATTACHMENT_COPY_FAILED")?;
                                copied.insert(source, path.clone());
                                path
                            };
                            attachment["storedPath"] = json!(destination);
                        }
                    }
                    atomic_json(&notes_path, &notes)?;
                    if !root.join("shortcuts.json").exists() {
                        if let Some(value) = read_json::<Value>(&legacy.join("shortcuts.json"))? {
                            atomic_json(&root.join("shortcuts.json"), &value)?;
                        }
                    }
                }
            }
        }
        let mut notes = read_json::<Vec<Value>>(&root.join("notes.json"))?.unwrap_or_default();
        for note in &mut notes {
            normalize_note(note)?;
        }
        if notes.is_empty() {
            notes = builtin_notes();
            atomic_json(&notes_path, &notes)?;
        }
        Ok(Self {
            root,
            notes,
            deleted: HashSet::new(),
        })
    }

    pub fn replace(&mut self, notes: Vec<Value>) -> Result<(), String> {
        atomic_json(&self.root.join("notes.json"), &notes)?;
        self.notes = notes;
        Ok(())
    }

    pub fn save(&mut self, mut note: Value) -> Result<Value, String> {
        normalize_note(&mut note)?;
        let id = note["id"].as_str().ok_or("INVALID_NOTE")?.to_owned();
        if self.deleted.contains(&id) || note["content"].as_str().unwrap().len() > 20_971_520 {
            return Err("INVALID_NOTE".into());
        }
        if let Some(previous) = self.notes.iter().find(|item| item["id"] == id) {
            if ["content", "attachments", "theme", "themeOpacity"]
                .iter()
                .all(|key| previous.get(*key) == note.get(*key))
            {
                // Viewing an unchanged note must not rewrite the collection or
                // change its modification time and navigation order.
                return Ok(previous.clone());
            }
        }
        for attachment in note["attachments"].as_array().unwrap() {
            managed_path(
                &self.root.join("attachments"),
                attachment["storedPath"]
                    .as_str()
                    .ok_or("INVALID_ATTACHMENT_PATH")?,
            )?;
        }
        let previous = self.notes.iter().find(|item| item["id"] == id);
        let object = note.as_object_mut().unwrap();
        for key in ["feishu", "feishuTargets"] {
            object.remove(key);
            if let Some(value) = previous.and_then(|n| n.get(key)) {
                object.insert(key.into(), value.clone());
            }
        }
        let same_content = previous.is_some_and(|n| n["content"] == object["content"]);
        object.insert(
            "createdAt".into(),
            previous
                .map(|n| n["createdAt"].clone())
                .unwrap_or_else(|| json!(now())),
        );
        object.insert("updatedAt".into(), json!(now()));
        object.insert(
            "syncState".into(),
            if same_content {
                previous.unwrap()["syncState"].clone()
            } else {
                json!("local")
            },
        );
        let mut next = vec![note.clone()];
        next.extend(self.notes.iter().filter(|n| n["id"] != id).cloned());
        self.replace(next)?;
        Ok(note)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        self.replace(
            self.notes
                .iter()
                .filter(|n| n["id"] != id)
                .cloned()
                .collect(),
        )?;
        self.deleted.insert(id.to_owned());
        Ok(())
    }

    pub fn ensure_importable(&self, note_id: &str) -> Result<(), String> {
        if note_id.is_empty() || self.deleted.contains(note_id) {
            Err("NOTE_MISSING".into())
        } else {
            Ok(())
        }
    }

    // Receives only user-provided bytes, never an external filesystem path.
    pub fn import_bytes(
        root: &Path,
        name: &str,
        data_base64: &str,
        image_only: bool,
    ) -> Result<Value, String> {
        if data_base64.len() > MAX_ATTACHMENT_BYTES.div_ceil(3) * 4 {
            return Err("ATTACHMENT_TOO_LARGE".into());
        }
        let bytes = STANDARD
            .decode(data_base64)
            .map_err(|_| "INVALID_ATTACHMENT_DATA")?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err("ATTACHMENT_TOO_LARGE".into());
        }
        let image = image_type(&bytes);
        if image_only && image.is_none() {
            return Err("UNSUPPORTED_CLIPBOARD_IMAGE".into());
        }
        let name = name.trim();
        if name.contains(['/', '\\'])
            || name.chars().any(char::is_control)
            || name.len() > 1024
            || matches!(name, "." | "..")
        {
            return Err("INVALID_ATTACHMENT_NAME".into());
        }
        let extension = image.map(|(_, ext)| ext).unwrap_or_else(|| {
            Path::new(name)
                .extension()
                .and_then(|ext| ext.to_str())
                .filter(|ext| ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
                .unwrap_or("bin")
        });
        let name = if image_only && (name.is_empty() || name == "image.png") {
            format!(
                "screenshot-{}.{}",
                chrono::Utc::now().format("%Y%m%d-%H%M%S"),
                extension
            )
        } else if name.is_empty() {
            return Err("INVALID_ATTACHMENT_NAME".into());
        } else {
            name.to_owned()
        };
        let destination =
            root.join("attachments")
                .join(format!("{}.{}", Uuid::new_v4(), extension));
        let mut file = tempfile::NamedTempFile::new_in(root.join("attachments"))
            .map_err(|_| "ATTACHMENT_COPY_FAILED")?;
        file.write_all(&bytes)
            .map_err(|_| "ATTACHMENT_COPY_FAILED")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "ATTACHMENT_COPY_FAILED")?;
        file.persist(&destination)
            .map_err(|_| "ATTACHMENT_COPY_FAILED")?;
        let mime = image
            .map(|(mime, _)| mime)
            .unwrap_or("application/octet-stream");
        let mut attachment = json!({ "id": Uuid::new_v4().to_string(), "name": name,
            "mimeType": mime, "size": bytes.len(), "storedPath": destination });
        if image.is_some() && bytes.len() <= 3 * 1024 * 1024 {
            attachment["previewDataUrl"] =
                json!(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)));
        }
        Ok(attachment)
    }

    pub fn attachment_preview(&self, note_id: &str, attachment_id: &str) -> Result<String, String> {
        let attachment = self
            .notes
            .iter()
            .find(|note| note["id"] == note_id)
            .and_then(|note| note["attachments"].as_array())
            .and_then(|items| items.iter().find(|item| item["id"] == attachment_id))
            .ok_or("INVALID_ATTACHMENT_PATH")?;
        let path = managed_path(
            &self.root.join("attachments"),
            attachment["storedPath"]
                .as_str()
                .ok_or("INVALID_ATTACHMENT_PATH")?,
        )?;
        let file = fs::File::open(path).map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?;
        let mut bytes = Vec::new();
        file.take((MAX_ATTACHMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err("ATTACHMENT_TOO_LARGE".into());
        }
        let (mime, _) = image_type(&bytes).ok_or("UNSUPPORTED_CLIPBOARD_IMAGE")?;
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }

    pub fn read_attachment_for_sync(
        &self,
        note_id: &str,
        attachment_id: &str,
    ) -> Result<(String, String, Vec<u8>), String> {
        let attachment = self
            .notes
            .iter()
            .find(|note| note["id"] == note_id)
            .and_then(|note| note["attachments"].as_array())
            .and_then(|items| items.iter().find(|item| item["id"] == attachment_id))
            .ok_or("INVALID_ATTACHMENT_PATH")?;
        let path = managed_path(
            &self.root.join("attachments"),
            attachment["storedPath"]
                .as_str()
                .ok_or("INVALID_ATTACHMENT_PATH")?,
        )?;
        let file = fs::File::open(path).map_err(|_| "ATTACHMENT_READ_FAILED")?;
        let mut bytes = Vec::new();
        file.take((MAX_ATTACHMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "ATTACHMENT_READ_FAILED")?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err("ATTACHMENT_TOO_LARGE".into());
        }
        let name = attachment["name"]
            .as_str()
            .filter(|value| !value.is_empty() && !value.contains(['/', '\\']))
            .ok_or("INVALID_ATTACHMENT_NAME")?
            .to_owned();
        let mime = attachment["mimeType"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .ok_or("INVALID_ATTACHMENT_TYPE")?
            .to_owned();
        Ok((name, mime, bytes))
    }

    pub fn import_file(root: &Path, source: &Path) -> Result<Value, String> {
        if !source.is_file() {
            return Err("INVALID_ATTACHMENT_PATH".into());
        }
        let name = source
            .file_name()
            .ok_or("INVALID_ATTACHMENT_PATH")?
            .to_string_lossy()
            .into_owned();
        let extension = source
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let destination =
            root.join("attachments")
                .join(format!("{}.{}", Uuid::new_v4(), extension));
        fs::copy(source, &destination).map_err(|_| "ATTACHMENT_COPY_FAILED")?;
        let size = destination
            .metadata()
            .map_err(|_| "ATTACHMENT_COPY_FAILED")?
            .len();
        let mime = match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            _ => "application/octet-stream",
        };
        let mut attachment = json!({ "id":Uuid::new_v4().to_string(), "name":name, "mimeType":mime, "size":size, "storedPath":destination });
        if mime.starts_with("image/") && size <= 3 * 1024 * 1024 {
            let bytes = fs::read(&destination).map_err(|_| "ATTACHMENT_COPY_FAILED")?;
            attachment["previewDataUrl"] =
                json!(format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        }
        Ok(attachment)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note() -> Value {
        json!({"id":"one", "content":"first", "attachments":[], "createdAt":"old", "updatedAt":"old", "syncState":"local"})
    }

    #[test]
    fn saves_survive_restart_and_deleted_notes_cannot_be_revived() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::load(temp.path().into(), None).unwrap();
        store.save(note()).unwrap();
        let restored = Store::load(temp.path().into(), None).unwrap();
        assert_eq!(restored.notes[0]["content"], "first");
        store.delete("one").unwrap();
        assert!(store.save(note()).is_err());
        assert!(!Store::load(temp.path().into(), None)
            .unwrap()
            .notes
            .iter()
            .any(|item| item["id"] == "one"));
    }

    #[test]
    fn fresh_store_seeds_two_product_notes_once() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::load(temp.path().into(), None).unwrap();
        assert_eq!(store.notes.len(), 2);
        assert_eq!(store.notes[0]["id"], "builtin-product-intro");
        assert_eq!(store.notes[1]["id"], "builtin-how-to-use");
        assert!(store.notes.iter().all(|item| item["content"]
            .as_str()
            .unwrap()
            .contains("imyuanwen@gmail.com")));

        let mut reopened = Store::load(temp.path().into(), None).unwrap();
        reopened.delete("builtin-product-intro").unwrap();
        reopened.delete("builtin-how-to-use").unwrap();
        let after_delete = Store::load(temp.path().into(), None).unwrap();
        assert_eq!(after_delete.notes.len(), 2);
        assert_eq!(after_delete.notes[0]["id"], "builtin-product-intro");
        assert_eq!(after_delete.notes[1]["id"], "builtin-how-to-use");
    }

    #[test]
    fn migration_copies_attachments_keeps_sync_metadata_and_only_runs_once() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("attachments")).unwrap();
        let file = old.path().join("attachments/file.txt");
        fs::write(&file, "attachment").unwrap();
        let mut legacy = note();
        legacy["title"] = json!("old title");
        legacy["feishu"] = json!({"documentId":"existing"});
        legacy["attachments"] = json!([{"id":"file", "storedPath":file}]);
        atomic_json(&old.path().join("notes.json"), &vec![legacy]).unwrap();
        let mut store = Store::load(new.path().into(), Some(old.path())).unwrap();
        assert_eq!(store.notes[0]["content"], "old title\nfirst");
        assert_eq!(store.notes[0]["feishu"]["documentId"], "existing");
        let path = store.notes[0]["attachments"][0]["storedPath"]
            .as_str()
            .unwrap();
        assert!(managed_path(&new.path().join("attachments"), path).is_ok());
        assert!(file.exists());
        store.delete("one").unwrap();
        let after_delete = Store::load(new.path().into(), Some(old.path())).unwrap();
        assert!(!after_delete.notes.iter().any(|item| item["id"] == "one"));
        assert_eq!(after_delete.notes.len(), 2);
    }

    #[test]
    fn corrupt_data_is_not_replaced_by_an_empty_store() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("notes.json"), "broken").unwrap();
        assert!(Store::load(temp.path().into(), None).is_err());
        assert_eq!(
            fs::read_to_string(temp.path().join("notes.json")).unwrap(),
            "broken"
        );
    }

    #[test]
    fn attachment_paths_cannot_escape_through_parent_components_or_symlinks() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("attachments")).unwrap();
        fs::write(root.path().join("outside"), "private").unwrap();
        let escaped = root.path().join("attachments/../outside");
        assert!(managed_path(&root.path().join("attachments"), escaped.to_str().unwrap()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                root.path().join("outside"),
                root.path().join("attachments/link"),
            )
            .unwrap();
            assert!(managed_path(
                &root.path().join("attachments"),
                root.path().join("attachments/link").to_str().unwrap()
            )
            .is_err());
        }
    }

    #[test]
    fn pasted_images_and_dropped_files_are_persisted_under_managed_paths() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::load(root.path().into(), None).unwrap();
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
        let image = Store::import_bytes(&store.root, "image.png", png, true).unwrap();
        assert!(image["name"].as_str().unwrap().starts_with("screenshot-"));
        assert_eq!(image["mimeType"], "image/png");
        assert!(image["previewDataUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        let path = managed_path(
            &store.root.join("attachments"),
            image["storedPath"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), STANDARD.decode(png).unwrap());
        let file = Store::import_bytes(
            &store.root,
            "报告.txt",
            &STANDARD.encode(b"work notes"),
            false,
        )
        .unwrap();
        assert_eq!(file["name"], "报告.txt");
        assert_eq!(file["size"], 10);
        assert!(file.get("previewDataUrl").is_none());
        let empty = Store::import_bytes(&store.root, "empty.txt", "", false).unwrap();
        assert_eq!(empty["size"], 0);
    }

    #[test]
    fn sync_reads_only_the_saved_attachment_from_the_managed_directory() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        let attachment = Store::import_bytes(
            &store.root,
            "notes.txt",
            &STANDARD.encode(b"sync me"),
            false,
        )
        .unwrap();
        let mut saved = note();
        saved["attachments"] = json!([attachment.clone()]);
        store.save(saved).unwrap();
        let (name, mime, bytes) = store
            .read_attachment_for_sync("one", attachment["id"].as_str().unwrap())
            .unwrap();
        assert_eq!(name, "notes.txt");
        assert_eq!(mime, "application/octet-stream");
        assert_eq!(bytes, b"sync me");
        assert!(store.read_attachment_for_sync("one", "other").is_err());
    }

    #[test]
    fn image_preview_is_bound_to_saved_note_and_attachment_and_checks_actual_bytes() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.resize(3 * 1024 * 1024 + 1, 0);
        let image =
            Store::import_bytes(&store.root, "large.png", &STANDARD.encode(&bytes), true).unwrap();
        assert!(image.get("previewDataUrl").is_none());
        let mut saved = note();
        saved["attachments"] = json!([image.clone()]);
        store.save(saved).unwrap();
        let id = image["id"].as_str().unwrap();
        let url = store.attachment_preview("one", id).unwrap();
        assert_eq!(
            STANDARD
                .decode(url.strip_prefix("data:image/png;base64,").unwrap())
                .unwrap(),
            bytes
        );
        assert!(store.attachment_preview("other", id).is_err());
        assert!(store.attachment_preview("one", "other").is_err());
        let path = image["storedPath"].as_str().unwrap();
        fs::write(path, b"<svg onload='bad'>").unwrap();
        assert!(store.attachment_preview("one", id).is_err());
        fs::File::create(path)
            .unwrap()
            .set_len((MAX_ATTACHMENT_BYTES + 1) as u64)
            .unwrap();
        assert_eq!(
            store.attachment_preview("one", id).unwrap_err(),
            "ATTACHMENT_TOO_LARGE"
        );
        store.delete("one").unwrap();
        assert!(store.attachment_preview("one", id).is_err());
    }

    #[test]
    fn byte_import_rejects_bad_data_names_sizes_and_non_image_clipboards_without_writing() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::load(root.path().into(), None).unwrap();
        let text = STANDARD.encode(b"<svg onload='bad'>");
        assert_eq!(
            Store::import_bytes(&store.root, "image.png", &text, true).unwrap_err(),
            "UNSUPPORTED_CLIPBOARD_IMAGE"
        );
        for name in ["../private", "C:\\private", ".", "..", "bad\nname"] {
            assert_eq!(
                Store::import_bytes(&store.root, name, &text, false).unwrap_err(),
                "INVALID_ATTACHMENT_NAME"
            );
        }
        assert_eq!(
            Store::import_bytes(&store.root, "file", "not base64!", false).unwrap_err(),
            "INVALID_ATTACHMENT_DATA"
        );
        let oversized = "A".repeat(MAX_ATTACHMENT_BYTES.div_ceil(3) * 4 + 1);
        assert_eq!(
            Store::import_bytes(&store.root, "file", &oversized, false).unwrap_err(),
            "ATTACHMENT_TOO_LARGE"
        );
        assert_eq!(
            fs::read_dir(store.root.join("attachments"))
                .unwrap()
                .count(),
            0
        );
        let disguised = Store::import_bytes(&store.root, "image.png", &text, false).unwrap();
        assert_eq!(disguised["mimeType"], "application/octet-stream");
        assert!(disguised.get("previewDataUrl").is_none());
    }

    #[test]
    fn import_allows_new_drafts_but_never_deleted_notes() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        assert!(store.ensure_importable("new-draft").is_ok());
        assert!(store.ensure_importable("").is_err());
        store.save(note()).unwrap();
        store.delete("one").unwrap();
        assert_eq!(store.ensure_importable("one").unwrap_err(), "NOTE_MISSING");
    }

    #[test]
    fn renderer_cannot_replace_sync_checkpoints() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        let mut first = note();
        first["feishu"] = json!({"documentId":"injected"});
        store.save(first).unwrap();
        assert!(store.notes[0].get("feishu").is_none());
        store.notes[0]["feishu"] = json!({"documentId":"native"});
        let mut next = note();
        next["feishu"] = json!({"documentId":"injected"});
        assert_eq!(store.save(next).unwrap()["feishu"]["documentId"], "native");
    }

    #[test]
    fn unchanged_saves_keep_modification_time_and_do_not_touch_disk() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        let saved = store.save(note()).unwrap();
        let path = root.path().join("notes.json");
        let before = fs::metadata(&path).unwrap().modified().unwrap();
        let mut unchanged = saved.clone();
        unchanged["updatedAt"] = json!("2099-01-01T00:00:00.000Z");
        unchanged["syncState"] = json!("error");
        assert_eq!(store.save(unchanged).unwrap(), saved);
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
        assert_eq!(
            Store::load(root.path().into(), None).unwrap().notes[0],
            saved
        );
    }
}
