use crate::credentials::parse_target;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};
use tokio::time::{sleep, Instant};

#[derive(Clone)]
pub struct SyncSession {
    pub owner_window: String,
    pub note_id: String,
    pub content: String,
    pub credentials: Value,
    pub documents: HashSet<String>,
    pub touched: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_code: Option<i64>,
    pub uncertain: bool,
}
impl FeishuError {
    pub fn new(message: &str, uncertain: bool) -> Self {
        Self {
            message: message.into(),
            api_code: None,
            uncertain,
        }
    }
}

pub fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn target_key(config: &Value) -> String {
    let app_id = config["appId"].as_str().unwrap_or("");
    if config["syncMode"] == "append" {
        let (kind, token) = config["targetDocumentUrl"]
            .as_str()
            .and_then(parse_target)
            .unwrap_or_default();
        format!("{app_id}:append:{kind}:{token}")
    } else {
        format!("{app_id}:create")
    }
}

pub fn new_session(note: &Value, config: Value) -> SyncSession {
    let mut documents = HashSet::new();
    let key = target_key(&config);
    let histories = note.get("feishu").into_iter().chain(
        note["feishuTargets"]
            .as_object()
            .into_iter()
            .flat_map(|v| v.values()),
    );
    for document in histories {
        let same_target = document["targetKey"] == key
            || (config["syncMode"] == "create" && document.get("targetKey").is_none());
        // Append mode authorizes the configured docx token or resolved wiki
        // object below, rather than every historical target on this note.
        if config["syncMode"] != "append" && document["appId"] == config["appId"] && same_target {
            if let Some(id) = document["documentId"].as_str().filter(|id| is_id(id)) {
                documents.insert(id.into());
            }
        }
    }
    if config["syncMode"] == "append" {
        if let Some((kind, token)) = config["targetDocumentUrl"].as_str().and_then(parse_target) {
            if kind == "docx" {
                documents.insert(token);
            }
        }
    }
    SyncSession {
        owner_window: String::new(),
        note_id: note["id"].as_str().unwrap().into(),
        content: note["content"].as_str().unwrap().into(),
        credentials: config,
        documents,
        touched: Instant::now(),
    }
}

// This is a Feishu document transport, not a general HTTP or shell proxy.
// Tokens are never returned to the renderer, and requests cannot change hosts.
pub fn allowed_request(session: &SyncSession, path: &str, method: &str, body: &Value) -> bool {
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains(['#', '\\'])
        || path.len() > 8192
    {
        return false;
    }
    let (route, query) = path.split_once('?').unwrap_or((path, ""));
    if route.contains('%') {
        return false;
    }
    let parts: Vec<_> = route.trim_start_matches('/').split('/').collect();
    let query: Vec<_> = url::form_urlencoded::parse(query.as_bytes()).collect();
    let append = session.credentials["syncMode"] == "append";
    let allowed_query = |keys: &[&str]| query.iter().all(|(key, _)| keys.contains(&key.as_ref()));
    match parts.as_slice() {
        ["wiki", "v2", "spaces", "get_node"] => {
            method == "GET"
                && append
                && query.len() == 1
                && query[0].0 == "token"
                && session.credentials["targetDocumentUrl"]
                    .as_str()
                    .and_then(parse_target)
                    .is_some_and(|(kind, token)| kind == "wiki" && query[0].1 == token)
        }
        ["docx", "v1", "documents", "blocks", "convert"] => {
            method == "POST"
                && query.is_empty()
                && body["content_type"] == "markdown"
                && body["content"]
                    .as_str()
                    .is_some_and(|s| s.len() <= 20_971_520)
        }
        ["docx", "v1", "documents"] => {
            !append
                && method == "POST"
                && query.is_empty()
                && body["title"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.chars().count() <= 800)
        }
        ["docx", "v1", "documents", id] => {
            method == "GET" && query.is_empty() && session.documents.contains(*id)
        }
        ["docx", "v1", "documents", id, "blocks"] => {
            method == "GET"
                && session.documents.contains(*id)
                && allowed_query(&["page_size", "page_token", "document_revision_id"])
        }
        ["docx", "v1", "documents", id, "blocks", block] => {
            session.documents.contains(*id)
                && id == block
                && ((method == "GET" && query.is_empty())
                    || (!append
                        && method == "PATCH"
                        && allowed_query(&["document_revision_id", "client_token"])))
        }
        ["docx", "v1", "documents", id, "blocks", block, "descendant"] => {
            method == "POST"
                && session.documents.contains(*id)
                && id == block
                && allowed_query(&["document_revision_id", "client_token"])
                && body["children_id"].is_array()
                && body["descendants"].is_array()
        }
        ["docx", "v1", "documents", id, "blocks", block, "children", "batch_delete"] => {
            method == "DELETE"
                && session.documents.contains(*id)
                && id == block
                && allowed_query(&["document_revision_id", "client_token"])
                && body["start_index"].as_u64().is_some()
                && body["end_index"].as_u64().is_some()
        }
        ["drive", "v1", "permissions", id, "members"] => {
            !append
                && method == "POST"
                && session.documents.contains(*id)
                && allowed_query(&["type", "need_notification"])
                && body["member_type"] == "email"
                && body["member_id"] == session.credentials["collaboratorEmail"]
                && body["perm"] == "edit"
                && body["type"] == "user"
        }
        _ => false,
    }
}

struct Token {
    app_id: String,
    secret: String,
    value: String,
    expires: Instant,
}
pub struct Network {
    client: reqwest::Client,
    next_request: Instant,
    token: Option<Token>,
}
impl Network {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "NETWORK_UNAVAILABLE")?;
        Ok(Self {
            client,
            next_request: Instant::now(),
            token: None,
        })
    }

    async fn raw(
        &mut self,
        path: &str,
        method: &str,
        body: &Value,
        token: Option<&str>,
    ) -> Result<Value, FeishuError> {
        let write = method != "GET";
        for attempt in 0..3 {
            sleep(self.next_request.saturating_duration_since(Instant::now())).await;
            self.next_request = Instant::now() + Duration::from_millis(400);
            let method = reqwest::Method::from_bytes(method.as_bytes())
                .map_err(|_| FeishuError::new("permission", false))?;
            let mut request = self
                .client
                .request(method, format!("https://open.feishu.cn/open-apis{path}"))
                .header("Content-Type", "application/json; charset=utf-8");
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            if !body.is_null() {
                request = request.json(body);
            }
            let response = request
                .send()
                .await
                .map_err(|_| FeishuError::new("network", write))?;
            let status = response.status();
            let data: Value = response
                .json()
                .await
                .map_err(|_| FeishuError::new("network", write))?;
            let code = data["code"]
                .as_i64()
                .ok_or_else(|| FeishuError::new("network", write))?;
            if status.as_u16() == 429 || code == 99991400 {
                if attempt < 2 {
                    sleep(Duration::from_millis(800 * 2u64.pow(attempt))).await;
                    continue;
                }
                return Err(FeishuError {
                    message: "rate-limit".into(),
                    api_code: Some(code),
                    uncertain: false,
                });
            }
            if !status.is_success() || code != 0 {
                let message = if status.as_u16() == 401 || code == 99991663 {
                    "auth"
                } else if status.as_u16() == 403 || matches!(code, 99991672 | 131006) {
                    "permission"
                } else if code == 1770021 {
                    "remote-changed"
                } else {
                    "feishu-api"
                };
                if message == "auth" {
                    self.token = None;
                }
                return Err(FeishuError {
                    message: message.into(),
                    api_code: Some(code),
                    uncertain: status.is_server_error() && write,
                });
            }
            return Ok(data);
        }
        unreachable!()
    }

    pub async fn request(
        &mut self,
        config: &Value,
        path: &str,
        method: &str,
        body: &Value,
    ) -> Result<Value, FeishuError> {
        let app_id = config["appId"]
            .as_str()
            .ok_or_else(|| FeishuError::new("auth", false))?;
        let secret = config["appSecret"]
            .as_str()
            .ok_or_else(|| FeishuError::new("auth", false))?;
        if !self
            .token
            .as_ref()
            .is_some_and(|t| t.app_id == app_id && t.secret == secret && t.expires > Instant::now())
        {
            let auth = self
                .raw(
                    "/auth/v3/tenant_access_token/internal",
                    "POST",
                    &json!({"app_id":app_id,"app_secret":secret}),
                    None,
                )
                .await
                .map_err(|mut error| {
                    if error.message == "feishu-api" {
                        error.message = "auth".into();
                    }
                    error
                })?;
            let token = auth["tenant_access_token"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| FeishuError::new("auth", false))?;
            let expire = auth["expire"]
                .as_u64()
                .ok_or_else(|| FeishuError::new("auth", false))?;
            self.token = Some(Token {
                app_id: app_id.into(),
                secret: secret.into(),
                value: token.into(),
                expires: Instant::now() + Duration::from_secs(expire.saturating_sub(60).min(86400)),
            });
        }
        let token = self.token.as_ref().unwrap().value.clone();
        self.raw(path, method, body, Some(&token)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_is_scoped_to_feishu_documents_and_never_exposes_authentication() {
        let note = json!({"id":"note","content":"text", "feishu":{"appId":"app","targetKey":"app:create","documentId":"Known"}});
        let session = new_session(
            &note,
            json!({"appId":"app","syncMode":"create","collaboratorEmail":"user@example.com"}),
        );
        assert!(allowed_request(
            &session,
            "/docx/v1/documents/Known",
            "GET",
            &Value::Null
        ));
        for path in [
            "/auth/v3/tenant_access_token/internal",
            "/docx/v1/documents/Other",
            "https://evil.test/",
            "//evil.test/",
            "/contact/v3/users",
            "/docx/v1/documents/Known%2fOther",
        ] {
            assert!(!allowed_request(&session, path, "GET", &Value::Null));
        }
    }
    #[test]
    fn append_mode_cannot_create_or_share_an_unrelated_document() {
        let session = new_session(
            &json!({"id":"note","content":"text"}),
            json!({"appId":"app","syncMode":"append","targetDocumentUrl":"https://tenant.feishu.cn/docx/Target"}),
        );
        assert!(allowed_request(
            &session,
            "/docx/v1/documents/Target/blocks?page_size=500",
            "GET",
            &Value::Null
        ));
        assert!(allowed_request(
            &session,
            "/docx/v1/documents/Target/blocks?page_size=500&page_token=Ab%2FC%3D",
            "GET",
            &Value::Null
        ));
        assert!(!allowed_request(
            &session,
            "/docx/v1/documents",
            "POST",
            &json!({"title":"New"})
        ));
        assert!(!allowed_request(
            &session,
            "/docx/v1/documents/Target",
            "DELETE",
            &Value::Null
        ));
    }
}
