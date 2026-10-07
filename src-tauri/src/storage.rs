use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;

pub fn data_root(home: &Path) -> PathBuf {
    home.join(".stikiii")
}

pub fn migration_source(
    root: &Path,
    previous: &Path,
    electron: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    if root.join("notes.json").try_exists().map_err(|_| "LOCAL_READ_FAILED")? {
        return Ok(None);
    }
    for source in std::iter::once(previous).chain(electron) {
        if source.join("notes.json").try_exists().map_err(|_| "LOCAL_READ_FAILED")? {
            return Ok(Some(source.to_path_buf()));
        }
    }
    Ok(None)
}

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

pub fn strip_attachment_previews(note: &mut Value) {
    if let Some(attachments) = note.get_mut("attachments").and_then(Value::as_array_mut) {
        for attachment in attachments {
            if let Some(object) = attachment.as_object_mut() { object.remove("previewDataUrl"); }
        }
    }
}

pub fn image_preview(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?;
    let mut bytes = Vec::new();
    file.take((MAX_ATTACHMENT_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?;
    if bytes.len() > MAX_ATTACHMENT_BYTES { return Err("ATTACHMENT_TOO_LARGE".into()); }
    image_type(&bytes).ok_or("UNSUPPORTED_CLIPBOARD_IMAGE")?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let thumbnail = reader.decode().map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?.thumbnail(640, 640);
    let mut output = std::io::Cursor::new(Vec::new());
    thumbnail.write_to(&mut output, image::ImageFormat::Png).map_err(|_| "ATTACHMENT_PREVIEW_FAILED")?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(output.into_inner())))
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
            "content": "# 贴贴便签｜使用方法\n\n## 1. 快速记录\n\n1. 在任意应用中按 `Command/Ctrl + Shift + Space` 唤起贴贴便签。\n2. 直接在正文区域输入内容，停止输入后会自动保存。\n3. 再次按快捷键可以隐藏窗口；关闭窗口也只会隐藏，不会退出应用。\n\n## 2. 编辑和整理\n\n- 第一行会作为便签标题显示，正文支持 Markdown。\n- 点击顶部的预览按钮查看排版，再切回编辑继续修改。\n- 点击加号新建便签，点击便签列表或页码在记录之间切换。\n- 使用主题和透明度设置，让便签适合你的桌面。\n\n## 3. 添加附件\n\n点击底部的附件按钮，从系统文件选择器添加图片或文件。附件会先复制到贴贴便签的应用数据目录，图片可以直接预览，其他文件可以交给系统打开。\n\n## 4. 同步到飞书\n\n1. 打开“设置 → 飞书”，填写 App ID、App Secret 和协作者邮箱。\n2. 选择“每条笔记创建新文档”，或粘贴目标文档链接并选择追加模式。\n3. 回到要同步的便签，点击底部的飞书按钮并确认结果。\n\n同步是手动触发的；本地图片会作为图片块上传，其他文件会作为附件块上传，Markdown 中的网络图片保留为链接。没有配置飞书时，记录仍可正常本地使用。\n\n## 5. 常用快捷键\n\n- `Command/Ctrl + Shift + Space`：唤起 / 隐藏便签\n- `Command/Ctrl + Shift + N`：新建便签\n- `Command/Ctrl + Alt + Left/Right`：上一条 / 下一条便签\n\n快捷键可以在底部“设置 → 全局快捷键”中修改。\n\n## 联系方式\n\n使用中遇到问题或想提出建议，请联系：**imyuanwen@gmail.com**。",
            "attachments": [],
            "createdAt": now,
            "updatedAt": now,
            "syncState": "local",
            "theme": "sage"
        }),
    ]
}

fn normalize_note(note: &mut Value) -> Result<(), String> {
    strip_attachment_previews(note);
    let object = note.as_object_mut().ok_or("INVALID_NOTE")?;
    for key in ["favorite", "archived"] {
        if object.get(key).is_some_and(|value| !value.is_boolean()) { return Err("INVALID_NOTE".into()); }
    }
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

fn migrate_note(
    note: &mut Value,
    legacy: &Path,
    root: &Path,
    copied: &mut HashMap<PathBuf, PathBuf>,
) -> Result<(), String> {
    normalize_note(note)?;
    for attachment in note["attachments"].as_array_mut().ok_or("INVALID_NOTE")? {
        let old_path = attachment["storedPath"].as_str().ok_or("INVALID_ATTACHMENT_PATH")?;
        let source = managed_path(&legacy.join("attachments"), old_path)?;
        let destination = if let Some(path) = copied.get(&source) {
            path.clone()
        } else {
            // New names prevent collisions with existing files or other source subdirectories.
            let mut path = root.join("attachments").join(Uuid::new_v4().to_string());
            if let Some(extension) = source.extension() {
                path.set_extension(extension);
            }
            let mut file = tempfile::NamedTempFile::new_in(root.join("attachments"))
                .map_err(|_| "ATTACHMENT_COPY_FAILED")?;
            let mut input = fs::File::open(&source).map_err(|_| "ATTACHMENT_COPY_FAILED")?;
            std::io::copy(&mut input, &mut file).map_err(|_| "ATTACHMENT_COPY_FAILED")?;
            file.as_file().sync_all().map_err(|_| "LOCAL_SAVE_FAILED")?;
            file.persist_noclobber(&path).map_err(|_| "ATTACHMENT_COPY_FAILED")?;
            copied.insert(source, path.clone());
            path
        };
        attachment["storedPath"] = json!(destination);
    }
    Ok(())
}

pub struct Store {
    pub root: PathBuf,
    pub notes: Vec<Value>,
    deleted: HashSet<String>,
    last_deleted: Option<(Value, std::time::Instant)>,
}

struct UpdatedNotes<'a> {
    note: &'a Value,
    notes: &'a [Value],
}

impl serde::Serialize for UpdatedNotes<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut sequence = serializer.serialize_seq(None)?;
        sequence.serialize_element(self.note)?;
        for note in self.notes.iter().filter(|note| note["id"] != self.note["id"]) {
            sequence.serialize_element(note)?;
        }
        sequence.end()
    }
}

impl Store {
    fn upsert(&mut self, mut note: Value) -> Result<Value, String> {
        strip_attachment_previews(&mut note);
        atomic_json(&self.root.join("notes.json"), &UpdatedNotes { note: &note, notes: &self.notes })?;
        // Publish in-memory state only after atomic persistence succeeds.
        self.notes.retain(|previous| previous["id"] != note["id"]);
        self.notes.insert(0, note.clone());
        Ok(note)
    }
    pub fn load(root: PathBuf, legacy: Option<&Path>) -> Result<Self, String> {
        fs::create_dir_all(root.join("attachments")).map_err(|_| "LOCAL_SAVE_FAILED")?;
        let notes_path = root.join("notes.json");
        let had_notes_file = notes_path.exists();
        if !had_notes_file {
            if let Some(legacy) = legacy {
                if let Some(mut notes) = read_json::<Vec<Value>>(&legacy.join("notes.json"))? {
                    let mut metadata = Vec::new();
                    for name in ["shortcuts.json", "note-windows.json", "sync-configs.public.json", "ai-config.public.json"] {
                        if !root.join(name).try_exists().map_err(|_| "LOCAL_READ_FAILED")? {
                            if let Some(value) = read_json::<Value>(&legacy.join(name))? {
                                metadata.push((name, value));
                            }
                        }
                    }
                    let recovery_path = root.join("recovery.json");
                    let mut recovery = if recovery_path.try_exists().map_err(|_| "LOCAL_READ_FAILED")? {
                        None
                    } else {
                        read_json::<Vec<crate::recovery::Entry>>(&legacy.join("recovery.json"))?
                    };
                    let mut copied = HashMap::new();
                    for note in &mut notes {
                        migrate_note(note, legacy, &root, &mut copied)?;
                    }
                    if let Some(entries) = &mut recovery {
                        for entry in entries.iter_mut() {
                            migrate_note(&mut entry.note, legacy, &root, &mut copied)?;
                        }
                        atomic_json(&recovery_path, entries)?;
                    }
                    for (name, value) in metadata {
                        atomic_json(&root.join(name), &value)?;
                    }
                    // Publish the library last: an interrupted migration is retried on startup.
                    atomic_json(&notes_path, &notes)?;
                }
            }
        }
        let mut notes = read_json::<Vec<Value>>(&root.join("notes.json"))?.unwrap_or_default();
        for note in &mut notes {
            normalize_note(note)?;
        }
        if notes.is_empty() && !notes_path.exists() {
            notes = builtin_notes();
            atomic_json(&notes_path, &notes)?;
        }
        Ok(Self {
            root,
            notes,
            deleted: HashSet::new(),
            last_deleted: None,
        })
    }

    pub fn replace(&mut self, mut notes: Vec<Value>) -> Result<(), String> {
        for note in &mut notes { strip_attachment_previews(note); }
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
            if ["content", "attachments", "theme", "themeOpacity", "favorite", "archived"]
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
        let same_content = previous.is_some_and(|n| n["content"] == object["content"] && n["attachments"] == object["attachments"]);
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
        self.upsert(note)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let snapshot = self.notes.iter().find(|note| note["id"] == id).cloned();
        if let Some(note) = &snapshot { crate::recovery::record(&self.root, note, "deleted")?; }
        self.replace(
            self.notes
                .iter()
                .filter(|n| n["id"] != id)
                .cloned()
                .collect(),
        )?;
        self.deleted.insert(id.to_owned());
        self.last_deleted = snapshot.map(|note| (note, std::time::Instant::now()));
        Ok(())
    }

    pub fn restore(&mut self, id: &str) -> Result<Value, String> {
        let (note, deleted_at) = self.last_deleted.as_ref().ok_or("RESTORE_UNAVAILABLE")?;
        if note["id"] != id || deleted_at.elapsed().as_secs() >= 10 { return Err("RESTORE_UNAVAILABLE".into()); }
        let restored = note.clone();
        self.upsert(restored.clone())?;
        self.deleted.remove(id);
        self.last_deleted = None;
        Ok(restored)
    }

    pub fn restore_recovery(&mut self, entry_id: &str) -> Result<Value, String> {
        let entry = crate::recovery::list(&self.root)?.into_iter().find(|entry| entry.id == entry_id).ok_or("RECOVERY_MISSING")?;
        let id = entry.note["id"].as_str().ok_or("INVALID_NOTE")?.to_owned();
        let previous = self.notes.iter().find(|note| note["id"] == id);
        if entry.reason == "deleted" && previous.is_some() { return Err("NOTE_ALREADY_EXISTS".into()); }
        if let Some(previous) = previous { crate::recovery::record(&self.root, previous, "restore-before")?; }
        let mut restored = entry.note;
        normalize_note(&mut restored)?;
        for attachment in restored["attachments"].as_array().unwrap() {
            managed_path(&self.root.join("attachments"), attachment["storedPath"].as_str().ok_or("INVALID_ATTACHMENT_PATH")?)?;
        }
        if let Some(previous) = previous {
            for key in ["feishu", "feishuTargets"] {
                restored.as_object_mut().unwrap().remove(key);
                if let Some(value) = previous.get(key) { restored[key] = value.clone(); }
            }
        }
        restored["syncState"] = json!("local");
        restored["updatedAt"] = json!(now());
        self.upsert(restored.clone())?;
        self.deleted.remove(&id);
        Ok(restored)
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
        let attachment = json!({ "id": Uuid::new_v4().to_string(), "name": name,
            "mimeType": mime, "size": bytes.len(), "storedPath": destination });
        Ok(attachment)
    }

    #[cfg(test)]
    pub fn attachment_preview(&self, note_id: &str, attachment_id: &str) -> Result<String, String> {
        image_preview(&self.attachment_preview_path(note_id, attachment_id)?)
    }

    pub fn attachment_preview_path(&self, note_id: &str, attachment_id: &str) -> Result<PathBuf, String> {
        let attachment = self
            .notes
            .iter()
            .find(|note| note["id"] == note_id)
            .and_then(|note| note["attachments"].as_array())
            .and_then(|items| items.iter().find(|item| item["id"] == attachment_id))
            .ok_or("INVALID_ATTACHMENT_PATH")?;
        managed_path(
            &self.root.join("attachments"),
            attachment["storedPath"]
                .as_str()
                .ok_or("INVALID_ATTACHMENT_PATH")?,
        )
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
        let attachment = json!({ "id":Uuid::new_v4().to_string(), "name":name, "mimeType":mime, "size":size, "storedPath":destination });
        Ok(attachment)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgba8(image::ImageBuffer::from_pixel(width, height, image::Rgba([80, 120, 200, 255])));
        let mut output = std::io::Cursor::new(Vec::new());
        image.write_to(&mut output, image::ImageFormat::Png).unwrap();
        output.into_inner()
    }
    fn note() -> Value {
        json!({"id":"one", "content":"first", "attachments":[], "createdAt":"old", "updatedAt":"old", "syncState":"local"})
    }

    #[test]
    fn home_directory_library_prefers_tauri_over_electron_and_existing_target_wins() {
        let home = tempfile::tempdir().unwrap();
        let previous = tempfile::tempdir().unwrap();
        let electron = tempfile::tempdir().unwrap();
        let root = data_root(home.path());
        assert_eq!(root, home.path().join(".stikiii"));
        atomic_json(&electron.path().join("notes.json"), &vec![note()]).unwrap();
        assert_eq!(migration_source(&root, previous.path(), Some(electron.path())).unwrap(), Some(electron.path().into()));
        atomic_json(&previous.path().join("notes.json"), &Vec::<Value>::new()).unwrap();
        assert_eq!(migration_source(&root, previous.path(), Some(electron.path())).unwrap(), Some(previous.path().into()));
        fs::write(previous.path().join("notes.json"), "corrupt").unwrap();
        let source = migration_source(&root, previous.path(), Some(electron.path())).unwrap();
        assert!(Store::load(root.clone(), source.as_deref()).is_err());
        assert!(!root.join("notes.json").exists());
        atomic_json(&root.join("notes.json"), &Vec::<Value>::new()).unwrap();
        assert_eq!(migration_source(&root, previous.path(), Some(electron.path())).unwrap(), None);
        assert!(Store::load(root, Some(previous.path())).unwrap().notes.is_empty());
    }

    #[test]
    fn directory_migration_preserves_settings_history_and_history_only_attachments() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("attachments")).unwrap();
        let file = old.path().join("attachments/current.txt");
        let history_file = old.path().join("attachments/deleted.txt");
        fs::write(&file, "current attachment").unwrap();
        fs::write(&history_file, "deleted attachment").unwrap();
        let mut current = note();
        current["attachments"] = json!([{"id":"file", "storedPath":file}]);
        current["favorite"] = json!(true);
        current["archived"] = json!(true);
        current["feishuTargets"] = json!({"fixture": {"documentId":"existing", "chapter":{"blockIds":["chapter"]}}});
        atomic_json(&old.path().join("notes.json"), &vec![current.clone()]).unwrap();
        crate::recovery::record(old.path(), &current, "ai-before").unwrap();
        let mut deleted = note();
        deleted["id"] = json!("deleted");
        deleted["attachments"] = json!([{"id":"history-file", "storedPath":history_file}]);
        let deleted_entry = crate::recovery::record(old.path(), &deleted, "deleted").unwrap();
        let metadata = [
            ("shortcuts.json", json!([{"action":"newNote", "accelerator":"Ctrl+Alt+N"}])),
            ("note-windows.json", json!({"one":{"x":100,"y":200,"width":440,"height":180,"open":true,"pinned":true,"pure":true,"normalHeight":390}})),
            ("sync-configs.public.json", json!([{"provider":"feishu", "appId":"fixture", "appSecretConfigured":true}])),
            ("ai-config.public.json", json!({"baseUrl":"https://api.example.com/v1", "model":"fixture", "apiKeyConfigured":true})),
        ];
        for (name, value) in &metadata { atomic_json(&old.path().join(name), value).unwrap(); }
        fs::write(old.path().join("sync-config.bin"), "legacy encrypted credential").unwrap();
        let old_notes = fs::read(old.path().join("notes.json")).unwrap();
        let old_history = fs::read(old.path().join("recovery.json")).unwrap();
        let store = Store::load(new.path().into(), Some(old.path())).unwrap();
        assert_eq!(store.notes[0]["content"], current["content"]);
        assert_eq!(store.notes[0]["favorite"], true);
        assert_eq!(store.notes[0]["archived"], true);
        assert_eq!(store.notes[0]["feishuTargets"], current["feishuTargets"]);
        for (name, value) in &metadata {
            assert_eq!(read_json::<Value>(&new.path().join(name)).unwrap().unwrap(), *value);
        }
        let windows = crate::note_windows::Registry::load(new.path()).unwrap();
        let layout = &windows.layouts["one"];
        assert!(layout.open && layout.pinned && layout.pure);
        assert_eq!((layout.x, layout.y, layout.width, layout.height, layout.normal_height), (100, 200, 440.0, 180.0, Some(390.0)));
        assert!(windows.bindings.is_empty());
        assert!(!new.path().join("sync-config.bin").exists());
        let history = crate::recovery::list(new.path()).unwrap();
        let version = history.iter().find(|entry| entry.reason == "ai-before").unwrap();
        assert_eq!(version.note["attachments"][0]["storedPath"], store.notes[0]["attachments"][0]["storedPath"]);
        assert_eq!(fs::read(store.notes[0]["attachments"][0]["storedPath"].as_str().unwrap()).unwrap(), b"current attachment");
        assert_eq!(fs::read(old.path().join("notes.json")).unwrap(), old_notes);
        assert_eq!(fs::read(old.path().join("recovery.json")).unwrap(), old_history);
        assert!(file.exists() && history_file.exists());
        drop(store);
        let mut restarted = Store::load(new.path().into(), Some(old.path())).unwrap();
        let restored = restarted.restore_recovery(&deleted_entry.id).unwrap();
        let restored_path = restored["attachments"][0]["storedPath"].as_str().unwrap();
        assert!(managed_path(&new.path().join("attachments"), restored_path).is_ok());
        assert_eq!(fs::read(restored_path).unwrap(), b"deleted attachment");
        assert_eq!(fs::read_dir(new.path().join("attachments")).unwrap().count(), 2);
    }

    #[test]
    fn migration_failure_does_not_publish_a_library_and_can_be_retried() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("attachments")).unwrap();
        let missing = old.path().join("attachments/missing.txt");
        let mut current = note();
        current["attachments"] = json!([{"id":"file", "storedPath":missing}]);
        atomic_json(&old.path().join("notes.json"), &vec![current]).unwrap();
        let before = fs::read(old.path().join("notes.json")).unwrap();
        assert!(Store::load(new.path().into(), Some(old.path())).is_err());
        assert!(!new.path().join("notes.json").exists());
        assert_eq!(fs::read(old.path().join("notes.json")).unwrap(), before);
        fs::write(missing, "restored attachment").unwrap();
        assert_eq!(Store::load(new.path().into(), Some(old.path())).unwrap().notes.len(), 1);
    }

    #[test]
    fn corrupt_history_or_settings_stop_migration_without_overwriting_source() {
        for name in ["recovery.json", "shortcuts.json"] {
            let old = tempfile::tempdir().unwrap();
            let new = tempfile::tempdir().unwrap();
            atomic_json(&old.path().join("notes.json"), &vec![note()]).unwrap();
            fs::write(old.path().join(name), "corrupt").unwrap();
            assert!(Store::load(new.path().into(), Some(old.path())).is_err());
            assert!(!new.path().join("notes.json").exists());
            assert_eq!(fs::read_to_string(old.path().join(name)).unwrap(), "corrupt");
        }
    }

    #[test]
    fn migration_keeps_existing_settings_and_avoids_attachment_filename_collisions() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir_all(old.path().join("attachments/a")).unwrap();
        fs::create_dir_all(old.path().join("attachments/b")).unwrap();
        fs::create_dir(new.path().join("attachments")).unwrap();
        let first = old.path().join("attachments/a/file.txt");
        let second = old.path().join("attachments/b/file.txt");
        fs::write(&first, "first file").unwrap();
        fs::write(&second, "second file").unwrap();
        fs::write(new.path().join("attachments/file.txt"), "existing file").unwrap();
        let mut current = note();
        current["attachments"] = json!([{"id":"a", "storedPath":first}, {"id":"b", "storedPath":second}]);
        atomic_json(&old.path().join("notes.json"), &vec![current]).unwrap();
        atomic_json(&old.path().join("shortcuts.json"), &json!(["old"])).unwrap();
        atomic_json(&new.path().join("shortcuts.json"), &json!(["new"])).unwrap();
        let store = Store::load(new.path().into(), Some(old.path())).unwrap();
        let attachments = store.notes[0]["attachments"].as_array().unwrap();
        assert_ne!(attachments[0]["storedPath"], attachments[1]["storedPath"]);
        assert_eq!(fs::read_to_string(attachments[0]["storedPath"].as_str().unwrap()).unwrap(), "first file");
        assert_eq!(fs::read_to_string(attachments[1]["storedPath"].as_str().unwrap()).unwrap(), "second file");
        assert_eq!(fs::read_to_string(new.path().join("attachments/file.txt")).unwrap(), "existing file");
        assert_eq!(read_json::<Value>(&new.path().join("shortcuts.json")).unwrap().unwrap(), json!(["new"]));
    }

    #[test]
    fn migration_rejects_attachments_outside_the_source_data_directory() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("attachments")).unwrap();
        let outside = old.path().join("outside.txt");
        fs::write(&outside, "outside").unwrap();
        let mut current = note();
        current["attachments"] = json!([{"id":"outside", "storedPath":outside}]);
        atomic_json(&old.path().join("notes.json"), &vec![current]).unwrap();
        assert!(Store::load(new.path().into(), Some(old.path())).is_err());
        assert!(!new.path().join("notes.json").exists());
        assert_eq!(fs::read_dir(new.path().join("attachments")).unwrap().count(), 0);
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
    fn undo_restores_only_the_last_deleted_native_snapshot_and_expires() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        let saved = store.save(note()).unwrap();
        store.delete("one").unwrap();
        assert!(store.restore("other").is_err());
        assert_eq!(store.restore("one").unwrap(), saved);
        assert!(store.restore("one").is_err());
        assert_eq!(store.save(saved.clone()).unwrap(), saved);
        store.delete("one").unwrap();
        store.last_deleted.as_mut().unwrap().1 = std::time::Instant::now() - std::time::Duration::from_secs(11);
        assert!(store.restore("one").is_err());
        assert!(store.save(saved).is_err());
    }

    #[test]
    fn existing_empty_libraries_and_empty_legacy_migrations_stay_empty() {
        let old = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        atomic_json(&old.path().join("notes.json"), &Vec::<Value>::new()).unwrap();
        assert!(Store::load(root.path().into(), Some(old.path())).unwrap().notes.is_empty());
        assert!(Store::load(root.path().into(), None).unwrap().notes.is_empty());
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
        assert!(after_delete.notes.is_empty());
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
        assert!(after_delete.notes.is_empty());
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
        let png = STANDARD.encode(png_bytes(1, 1));
        let image = Store::import_bytes(&store.root, "image.png", &png, true).unwrap();
        assert!(image["name"].as_str().unwrap().starts_with("screenshot-"));
        assert_eq!(image["mimeType"], "image/png");
        assert!(image.get("previewDataUrl").is_none());
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
        let bytes = png_bytes(1600, 900);
        let image =
            Store::import_bytes(&store.root, "large.png", &STANDARD.encode(&bytes), true).unwrap();
        assert!(image.get("previewDataUrl").is_none());
        let mut saved = note();
        saved["attachments"] = json!([image.clone()]);
        store.save(saved).unwrap();
        let id = image["id"].as_str().unwrap();
        let url = store.attachment_preview("one", id).unwrap();
        let thumbnail = image::load_from_memory(&STANDARD.decode(url.strip_prefix("data:image/png;base64,").unwrap()).unwrap()).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (640, 360));
        assert_eq!(store.read_attachment_for_sync("one", id).unwrap().2, bytes);
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
    fn thumbnails_reject_corrupt_and_excessive_dimensions_without_rewriting_originals() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("fixture");
        for bytes in [b"\x89PNG\r\n\x1a\n".to_vec(), png_bytes(16_385, 1)] {
            fs::write(&path, &bytes).unwrap();
            assert!(image_preview(&path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let image = image::DynamicImage::ImageRgb8(image::ImageBuffer::from_pixel(800, 400, image::Rgb([90, 120, 180])));
        for format in [image::ImageFormat::Png, image::ImageFormat::Jpeg, image::ImageFormat::Gif, image::ImageFormat::WebP, image::ImageFormat::Bmp] {
            let mut output = std::io::Cursor::new(Vec::new());
            image.write_to(&mut output, format).unwrap();
            let original = output.into_inner(); fs::write(&path, &original).unwrap();
            let preview = image_preview(&path).unwrap();
            let thumbnail = image::load_from_memory(&STANDARD.decode(preview.strip_prefix("data:image/png;base64,").unwrap()).unwrap()).unwrap();
            assert_eq!((thumbnail.width(), thumbnail.height()), (640, 320));
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }

    #[test]
    fn legacy_previews_are_removed_on_read_and_real_save_without_changing_note_metadata() {
        let root = tempfile::tempdir().unwrap();
        Store::load(root.path().into(), None).unwrap();
        let path = root.path().join("attachments/fixture.png"); fs::write(&path, png_bytes(1, 1)).unwrap();
        let mut original = note();
        original["attachments"] = json!([{"id":"image","storedPath":path,"name":"fixture.png","mimeType":"image/png","size":1,"previewDataUrl":"data:image/png;base64,legacy"}]);
        atomic_json(&root.path().join("notes.json"), &vec![original.clone()]).unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        assert!(store.notes[0]["attachments"][0].get("previewDataUrl").is_none());
        assert_eq!(store.notes[0]["updatedAt"], original["updatedAt"]);
        assert_eq!(fs::read_to_string(root.path().join("notes.json")).unwrap().contains("previewDataUrl"), true);
        let mut changed = store.notes[0].clone(); changed["content"] = json!("new content");
        store.save(changed).unwrap();
        assert!(!fs::read_to_string(root.path().join("notes.json")).unwrap().contains("previewDataUrl"));
        let entry = crate::recovery::record(root.path(), &original, "ai-before").unwrap();
        assert!(entry.note["attachments"][0].get("previewDataUrl").is_none());
        assert!(!fs::read_to_string(root.path().join("recovery.json")).unwrap().contains("previewDataUrl"));
    }

    #[test]
    fn streamed_upsert_keeps_order_and_publishes_memory_only_after_disk_success() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::load(root.path().into(), None).unwrap();
        store.replace(Vec::new()).unwrap();
        let mut first = note(); first["id"] = json!("first"); store.save(first).unwrap();
        let mut second = note(); second["id"] = json!("second"); store.save(second).unwrap();
        let mut changed = store.notes[1].clone(); changed["content"] = json!("updated");
        let before = store.notes.clone();
        fs::remove_file(root.path().join("notes.json")).unwrap();
        fs::create_dir(root.path().join("notes.json")).unwrap();
        assert!(store.save(changed.clone()).is_err());
        assert_eq!(store.notes, before);
        fs::remove_dir(root.path().join("notes.json")).unwrap();
        store.save(changed).unwrap();
        assert_eq!(store.notes.iter().map(|note| note["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["first", "second"]);
        assert_eq!(read_json::<Vec<Value>>(&root.path().join("notes.json")).unwrap().unwrap(), store.notes);
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
