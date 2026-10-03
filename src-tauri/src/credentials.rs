use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

pub trait Vault: Send + Sync {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
}

// Only successful reads and writes are cached, within the native process.
pub struct CachedVault {
    inner: Box<dyn Vault>,
    value: Mutex<Option<Option<String>>>,
}

impl CachedVault {
    pub fn new(inner: Box<dyn Vault>) -> Self {
        Self {
            inner,
            value: Mutex::new(None),
        }
    }
}

impl Vault for CachedVault {
    fn read(&self) -> Result<Option<String>, String> {
        let mut cached = self.value.lock().map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?;
        if let Some(value) = &*cached {
            return Ok(value.clone());
        }
        let value = self.inner.read()?;
        *cached = Some(value.clone());
        Ok(value)
    }

    fn write(&self, value: &str) -> Result<(), String> {
        let mut cached = self.value.lock().map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?;
        self.inner.write(value)?;
        *cached = Some(Some(value.into()));
        Ok(())
    }
}

struct SystemVault {
    service: String,
    account: String,
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
impl Vault for SystemVault {
    fn read(&self) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(&self.service, &self.account)
            .map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("SYNC_CONFIG_UNAVAILABLE".into()),
        }
    }
    fn write(&self, value: &str) -> Result<(), String> {
        keyring::Entry::new(&self.service, &self.account)
            .and_then(|entry| entry.set_password(value))
            .map_err(|_| "SYNC_CONFIG_UNAVAILABLE".into())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl Vault for SystemVault {
    fn read(&self) -> Result<Option<String>, String> {
        Err("SYNC_CONFIG_UNAVAILABLE".into())
    }
    fn write(&self, _value: &str) -> Result<(), String> {
        Err("SYNC_CONFIG_UNAVAILABLE".into())
    }
}

pub fn is_provider(provider: &str) -> bool {
    matches!(provider, "feishu" | "notion")
}

pub fn parse_target(value: &str) -> Option<(String, String)> {
    let url = url::Url::parse(value.trim()).ok()?;
    let host = url.host_str()?;
    let path = url.path().strip_prefix('/')?;
    let parts: Vec<_> = path.strip_suffix('/').unwrap_or(path).split('/').collect();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !(host == "feishu.cn" || host.ends_with(".feishu.cn"))
        || parts.len() != 2
        || !matches!(parts[0], "docx" | "wiki")
        || parts[1].is_empty()
        || !parts[1].bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return None;
    }
    Some((parts[0].into(), parts[1].into()))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicConfig {
    provider: String,
    app_id: String,
    app_secret_configured: bool,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    collaborator_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sync_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_document_url: Option<String>,
}

pub fn public_config(provider: &str, config: &Value) -> Value {
    json!(PublicConfig {
        provider: provider.into(),
        app_id: config["appId"].as_str().unwrap().into(),
        app_secret_configured: true,
        updated_at: config["updatedAt"].as_str().unwrap().into(),
        collaborator_email: config["collaboratorEmail"].as_str().map(String::from),
        sync_mode: config["syncMode"].as_str().map(String::from),
        target_document_url: config["targetDocumentUrl"].as_str().map(String::from),
    })
}

pub struct ConfigStore {
    vault: Box<dyn Vault>,
    public_path: PathBuf,
}
pub fn system_vault(account: &str) -> Box<dyn Vault> {
    let service = "com.dawinyuan.desktabs".to_string();
    #[cfg(debug_assertions)]
    let service = if let Some(path) = std::env::var_os("DESK_TABS_DEV_DATA_DIR") {
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hash);
        format!("{service}.qa.{:x}", hash.finish())
    } else {
        service
    };
    Box::new(CachedVault::new(Box::new(SystemVault {
        service,
        account: account.into(),
    })))
}
impl ConfigStore {
    pub fn system(root: &Path) -> Self {
        Self {
            vault: system_vault("sync-configs"),
            public_path: root.join("sync-configs.public.json"),
        }
    }

    fn persist_public(&self, configs: &Map<String, Value>) -> Result<(), String> {
        let public: Vec<_> = configs
            .iter()
            .map(|(provider, config)| public_config(provider, config))
            .collect();
        crate::storage::atomic_json(&self.public_path, &public)
            .map_err(|_| "SYNC_CONFIG_UNAVAILABLE".into())
    }

    fn load(&self) -> Result<Map<String, Value>, String> {
        let configs: Map<String, Value> = match self.vault.read()? {
            Some(value) => serde_json::from_str(&value).map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?,
            None => Map::new(),
        };
        for (provider, config) in &configs {
            if !is_provider(provider)
                || config["appId"].as_str().is_none_or(str::is_empty)
                || config["appSecret"].as_str().is_none_or(str::is_empty)
                || !config["updatedAt"].is_string()
            {
                return Err("SYNC_CONFIG_UNAVAILABLE".into());
            }
        }
        self.persist_public(&configs)?;
        Ok(configs)
    }

    pub fn list(&self, load_saved: bool) -> Result<Vec<Value>, String> {
        match crate::storage::read_json::<Vec<PublicConfig>>(&self.public_path)
            .map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?
        {
            Some(configs) => Ok(configs.into_iter().map(|config| json!(config)).collect()),
            None if load_saved => Ok(self
                .load()?
                .iter()
                .map(|(provider, config)| public_config(provider, config))
                .collect()),
            None => Ok(Vec::new()),
        }
    }

    pub fn credentials(&self, provider: &str) -> Result<Option<Value>, String> {
        Ok(self.load()?.get(provider).cloned())
    }

    fn save_inner(&self, input: &Value) -> Result<Value, String> {
        let provider = input["provider"].as_str().ok_or("invalid")?;
        let id = input["appId"].as_str().ok_or("invalid")?.trim();
        let supplied = input["appSecret"].as_str().ok_or("invalid")?.trim();
        if !is_provider(provider) || id.is_empty() || id.len() > 512 || supplied.len() > 8192 {
            return Err("invalid".into());
        }
        let mut configs = self.load()?;
        let previous = configs.get(provider);
        let secret = if supplied.is_empty() {
            previous
                .filter(|v| v["appId"] == id)
                .and_then(|v| v["appSecret"].as_str())
                .ok_or("invalid")?
        } else {
            supplied
        };
        let email = input
            .get("collaboratorEmail")
            .or_else(|| previous.and_then(|v| v.get("collaboratorEmail")));
        if let Some(email) = email {
            let text = email.as_str().ok_or("invalid")?.trim();
            if text.len() > 254
                || (!text.is_empty()
                    && (text.contains(char::is_whitespace)
                        || text.split('@').count() != 2
                        || text.starts_with('@')
                        || text.ends_with('@')
                        || !text.rsplit('@').next().unwrap().contains('.')))
            {
                return Err("invalid".into());
            }
        }
        if input
            .get("syncMode")
            .is_some_and(|mode| mode != "create" && mode != "append")
        {
            return Err("invalid".into());
        }
        let mode = input
            .get("syncMode")
            .or_else(|| previous.and_then(|v| v.get("syncMode")))
            .and_then(Value::as_str)
            .unwrap_or("create");
        if !matches!(mode, "create" | "append") {
            return Err("invalid".into());
        }
        let target = input
            .get("targetDocumentUrl")
            .or_else(|| previous.and_then(|v| v.get("targetDocumentUrl")));
        if let Some(target) = target {
            if !target.is_string() || target.as_str().unwrap().len() > 2048 {
                return Err("invalid".into());
            }
        }
        if provider == "feishu"
            && mode == "append"
            && target
                .and_then(Value::as_str)
                .and_then(parse_target)
                .is_none()
        {
            return Err("invalid".into());
        }
        let mut next = json!({"appId":id,"appSecret":secret,"syncMode":mode,"updatedAt":crate::storage::now()});
        if let Some(email) = email {
            next["collaboratorEmail"] = json!(email.as_str().unwrap().trim());
        }
        if let Some(target) = target {
            next["targetDocumentUrl"] = json!(target.as_str().unwrap().trim());
        }
        configs.insert(provider.into(), next);
        self.vault
            .write(&serde_json::to_string(&configs).map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?)?;
        self.persist_public(&configs)?;
        Ok(json!({"status":"saved","provider":provider}))
    }

    pub fn save(&self, input: &Value) -> Value {
        self.save_inner(input).unwrap_or_else(
            |error| json!({"status": if error == "invalid" {"invalid"} else {"unavailable"}}),
        )
    }

    pub fn clear(&self, provider: &str) -> Value {
        if !is_provider(provider) {
            return json!({"status":"invalid"});
        }
        let operation = || -> Result<(), String> {
            let mut configs = self.load()?;
            configs.remove(provider);
            self.vault
                .write(&serde_json::to_string(&configs).map_err(|_| "SYNC_CONFIG_UNAVAILABLE")?)?;
            self.persist_public(&configs)
        };
        match operation() {
            Ok(()) => json!({"status":"cleared","provider":provider}),
            Err(_) => json!({"status":"unavailable"}),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    struct TestVault(Arc<Mutex<Option<String>>>);
    impl Vault for TestVault {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn write(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.into());
            Ok(())
        }
    }

    struct ObservedVault {
        data: Arc<Mutex<Option<String>>>,
        reads: Arc<AtomicUsize>,
        denied: Arc<AtomicBool>,
    }
    impl Vault for ObservedVault {
        fn read(&self) -> Result<Option<String>, String> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.denied.load(Ordering::SeqCst) {
                return Err("SYNC_CONFIG_UNAVAILABLE".into());
            }
            Ok(self.data.lock().unwrap().clone())
        }
        fn write(&self, value: &str) -> Result<(), String> {
            if self.denied.load(Ordering::SeqCst) {
                return Err("SYNC_CONFIG_UNAVAILABLE".into());
            }
            *self.data.lock().unwrap() = Some(value.into());
            Ok(())
        }
    }

    #[test]
    fn startup_never_unlocks_and_legacy_configs_migrate_only_on_request() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("public.json");
        let original = json!({"feishu":{"appId":"cli_test","appSecret":"private-secret","accessToken":"extra-secret","updatedAt":"now","syncMode":"create"}}).to_string();
        let data = Arc::new(Mutex::new(Some(original.clone())));
        let reads = Arc::new(AtomicUsize::new(0));
        let denied = Arc::new(AtomicBool::new(true));
        let store = ConfigStore {
            public_path: path.clone(),
            vault: Box::new(CachedVault::new(Box::new(ObservedVault {
                data: data.clone(),
                reads: reads.clone(),
                denied: denied.clone(),
            }))),
        };
        assert!(store.list(false).unwrap().is_empty());
        assert_eq!(reads.load(Ordering::SeqCst), 0);
        assert!(!path.exists());
        assert!(store.list(true).is_err());
        assert!(!path.exists());
        assert_eq!(data.lock().unwrap().as_deref(), Some(original.as_str()));
        denied.store(false, Ordering::SeqCst);
        assert_eq!(store.list(true).unwrap()[0]["appId"], "cli_test");
        assert_eq!(
            store.credentials("feishu").unwrap().unwrap()["appSecret"],
            "private-secret"
        );
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        let public = std::fs::read_to_string(&path).unwrap();
        assert!(
            !public.contains("\"appSecret\"")
                && !public.contains("private-secret")
                && !public.contains("accessToken")
                && !public.contains("extra-secret")
        );
        denied.store(true, Ordering::SeqCst);
        let restarted = ConfigStore {
            public_path: path,
            vault: Box::new(ObservedVault {
                data: data.clone(),
                reads: reads.clone(),
                denied: denied.clone(),
            }),
        };
        assert_eq!(restarted.list(false).unwrap()[0]["appId"], "cli_test");
        assert_eq!(restarted.list(true).unwrap()[0]["appId"], "cli_test");
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        assert_eq!(restarted.clear("feishu")["status"], "unavailable");
        assert_eq!(restarted.list(false).unwrap()[0]["appId"], "cli_test");
        assert_eq!(data.lock().unwrap().as_deref(), Some(original.as_str()));
        denied.store(false, Ordering::SeqCst);
        assert_eq!(
            store.save(
                &json!({"provider":"feishu","appId":"cli_test","appSecret":"replacement-key"})
            )["status"],
            "saved"
        );
        assert_eq!(
            store.credentials("feishu").unwrap().unwrap()["appSecret"],
            "replacement-key"
        );
        assert_eq!(store.clear("feishu")["status"], "cleared");
        assert!(store.credentials("feishu").unwrap().is_none());
        assert!(restarted.list(false).unwrap().is_empty());
        assert_eq!(reads.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn native_cache_tracks_successful_writes_and_retries_denied_reads() {
        let data = Arc::new(Mutex::new(None));
        let reads = Arc::new(AtomicUsize::new(0));
        let denied = Arc::new(AtomicBool::new(true));
        let cache = CachedVault::new(Box::new(ObservedVault {
            data: data.clone(),
            reads: reads.clone(),
            denied: denied.clone(),
        }));
        assert!(cache.read().is_err());
        denied.store(false, Ordering::SeqCst);
        assert_eq!(cache.read().unwrap(), None);
        assert_eq!(cache.read().unwrap(), None);
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        cache.write("first-key").unwrap();
        assert_eq!(cache.read().unwrap().as_deref(), Some("first-key"));
        denied.store(true, Ordering::SeqCst);
        assert!(cache.write("rejected-key").is_err());
        assert_eq!(cache.read().unwrap().as_deref(), Some("first-key"));
        denied.store(false, Ordering::SeqCst);
        cache.write("null").unwrap();
        assert_eq!(cache.read().unwrap().as_deref(), Some("null"));
        assert_eq!(data.lock().unwrap().as_deref(), Some("null"));
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn public_configs_hide_secrets_and_blank_input_preserves_the_original() {
        let data = Arc::new(Mutex::new(None));
        let root = tempfile::tempdir().unwrap();
        let store = ConfigStore {
            public_path: root.path().join("public.json"),
            vault: Box::new(TestVault(data.clone())),
        };
        assert_eq!(
            store.save(&json!({"provider":"feishu","appId":"cli_test","appSecret":"private"}))
                ["status"],
            "saved"
        );
        assert!(store.list(false).unwrap()[0].get("appSecret").is_none());
        assert_eq!(
            store.save(&json!({"provider":"feishu","appId":"cli_test","appSecret":""}))["status"],
            "saved"
        );
        assert_eq!(
            store.credentials("feishu").unwrap().unwrap()["appSecret"],
            "private"
        );
        assert_eq!(
            store.save(&json!({"provider":"feishu","appId":"different","appSecret":""}))["status"],
            "invalid"
        );
        assert_eq!(store.clear("feishu")["status"], "cleared");
        assert!(store.list(false).unwrap().is_empty());
    }

    #[test]
    fn corrupt_vault_is_not_overwritten_and_append_targets_are_validated() {
        let data = Arc::new(Mutex::new(Some("corrupt".into())));
        let root = tempfile::tempdir().unwrap();
        let store = ConfigStore {
            public_path: root.path().join("public.json"),
            vault: Box::new(TestVault(data.clone())),
        };
        assert_eq!(
            store.save(&json!({"provider":"feishu","appId":"id","appSecret":"secret"}))["status"],
            "unavailable"
        );
        assert_eq!(data.lock().unwrap().as_deref(), Some("corrupt"));
        assert!(parse_target("https://tenant.feishu.cn/wiki/Valid123").is_some());
        for url in [
            "https://feishu.cn.evil.test/docx/Token",
            "https://user@feishu.cn/docx/Token",
            "http://feishu.cn/docx/Token",
            "https://feishu.cn/sheets/Token",
        ] {
            assert!(parse_target(url).is_none());
        }
    }
}
