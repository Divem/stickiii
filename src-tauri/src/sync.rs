use crate::credentials::parse_target;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};
use tokio::time::{sleep, Instant};

#[derive(Clone)]
pub struct SyncSession {
    pub owner_window: String,
    pub note_id: String,
    pub content: String,
    pub credentials: Value,
    pub documents: HashSet<String>,
    pub attachments: HashMap<String, Value>,
    pub media_nodes: HashMap<String, String>,
    pub touched: Instant,
}

#[derive(Debug, Serialize)]
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
    let attachments = note["attachments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|attachment| {
            attachment["id"]
                .as_str()
                .map(|id| (id.to_owned(), attachment.clone()))
        })
        .collect();
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
        attachments,
        media_nodes: HashMap::new(),
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
            let text_patch = !append && body["update_text_elements"].is_object();
            let media_patch = session.media_nodes.get(*block).is_some_and(|kind| {
                (kind == "docx_image" && body["replace_image"].is_object())
                    || (kind == "docx_file" && body["replace_file"].is_object())
            });
            session.documents.contains(*id)
                && ((method == "GET" && id == block && query.is_empty())
                    || (method == "PATCH"
                        && allowed_query(&["document_revision_id", "client_token"])
                        && ((id == block && text_patch) || media_patch)))
        }
        ["docx", "v1", "documents", id, "blocks", block, "children"] => {
            method == "POST"
                && session.documents.contains(*id)
                && id == block
                && allowed_query(&["document_revision_id", "client_token"])
                && body["index"].as_i64().is_some()
                && body["children"].as_array().is_some_and(|children| {
                    children.len() == 1
                        && children[0]["block_type"]
                            .as_i64()
                            .is_some_and(|kind| kind == 23 || kind == 27)
                        && ((children[0]["block_type"] == 27 && children[0]["image"].is_object())
                            || (children[0]["block_type"] == 23 && children[0]["file"].is_object()))
                })
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
        ["drive", "v1", "medias", "upload_all"] => {
            method == "POST"
                && query.is_empty()
                && body["attachment_id"]
                    .as_str()
                    .is_some_and(|id| session.attachments.contains_key(id))
                && body["parent_node"].as_str().is_some_and(|node| is_id(node))
                && body["parent_type"].as_str().is_some_and(|kind| {
                    matches!(kind, "docx_image" | "docx_file")
                        && session
                            .media_nodes
                            .get(body["parent_node"].as_str().unwrap())
                            .is_some_and(|registered| registered == kind)
                })
                && body.get("file_name").is_none_or(|name| {
                    name.as_str()
                        .is_some_and(|name| !name.is_empty() && name.len() <= 1024)
                })
                && body
                    .get("size")
                    .is_none_or(|size| size.as_u64().is_some_and(|size| size <= 20 * 1024 * 1024))
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
    #[cfg(test)]
    api_origin: String,
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
            #[cfg(test)]
            api_origin: "https://open.feishu.cn/open-apis".into(),
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
            #[cfg(not(test))]
            let origin = "https://open.feishu.cn/open-apis";
            #[cfg(test)]
            let origin = self.api_origin.as_str();
            let mut request = self
                .client
                .request(method, format!("{origin}{path}"))
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

    async fn ensure_token(&mut self, config: &Value) -> Result<String, FeishuError> {
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
        Ok(self.token.as_ref().unwrap().value.clone())
    }

    pub async fn request(
        &mut self,
        config: &Value,
        path: &str,
        method: &str,
        body: &Value,
    ) -> Result<Value, FeishuError> {
        let token = self.ensure_token(config).await?;
        self.raw(path, method, body, Some(&token)).await
    }

    pub async fn check_connection(&mut self, config: &Value) -> Result<Value, FeishuError> {
        let started = Instant::now();
        self.ensure_token(config).await?;
        if config["syncMode"] != "append" {
            return Ok(json!({"status":"connected", "scope":"authentication", "latencyMs":started.elapsed().as_millis()}));
        }
        let (kind, target) = config["targetDocumentUrl"].as_str().and_then(parse_target).ok_or_else(|| FeishuError::new("target-required", false))?;
        let document_id = if kind == "wiki" {
            let node = self.request(config, &format!("/wiki/v2/spaces/get_node?token={target}"), "GET", &Value::Null).await?;
            if node["data"]["node"]["obj_type"] != "docx" { return Err(FeishuError::new("unsupported-target", false)); }
            node["data"]["node"]["obj_token"].as_str().filter(|id| is_id(id)).ok_or_else(|| FeishuError::new("invalid-target", false))?.to_owned()
        } else { target };
        let document = self.request(config, &format!("/docx/v1/documents/{document_id}"), "GET", &Value::Null).await?;
        // Official SDK: drive.v1.permissionMember.Auth, action=edit. This checks
        // the caller's edit permission without modifying the target document.
        let permission = self.request(config, &format!("/drive/v1/permissions/{document_id}/members/auth?type=docx&action=edit"), "GET", &Value::Null).await?;
        match permission["data"]["auth_result"].as_bool() {
            Some(true) => Ok(json!({"status":"connected", "scope":"target", "title":document["data"]["document"]["title"], "latencyMs":started.elapsed().as_millis()})),
            Some(false) => Err(FeishuError::new("permission", false)),
            None => Err(FeishuError::new("invalid-response", false)),
        }
    }

    pub async fn upload_media(
        &mut self,
        config: &Value,
        name: &str,
        mime: &str,
        bytes: Vec<u8>,
        parent_type: &str,
        parent_node: &str,
    ) -> Result<Value, FeishuError> {
        let token = self.ensure_token(config).await?;
        for attempt in 0..3 {
            sleep(self.next_request.saturating_duration_since(Instant::now())).await;
            self.next_request = Instant::now() + Duration::from_millis(400);
            let file = reqwest::multipart::Part::bytes(bytes.clone())
                .file_name(name.to_owned())
                .mime_str(mime)
                .map_err(|_| FeishuError::new("invalid-attachment", false))?;
            let form = reqwest::multipart::Form::new()
                .text("file_name", name.to_owned())
                .text("parent_type", parent_type.to_owned())
                .text("parent_node", parent_node.to_owned())
                .text("size", bytes.len().to_string())
                .part("file", file);
            let response = self
                .client
                .post("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all")
                .bearer_auth(&token)
                .multipart(form)
                .send()
                .await
                .map_err(|_| FeishuError::new("network", true))?;
            let status = response.status();
            let data: Value = response
                .json()
                .await
                .map_err(|_| FeishuError::new("network", true))?;
            let code = data["code"]
                .as_i64()
                .ok_or_else(|| FeishuError::new("network", true))?;
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
                } else {
                    "feishu-api"
                };
                if message == "auth" {
                    self.token = None;
                }
                return Err(FeishuError {
                    message: message.into(),
                    api_code: Some(code),
                    uncertain: status.is_server_error(),
                });
            }
            return Ok(data);
        }
        unreachable!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection_fixture(responses: Vec<Value>) -> (Network, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut network = Network::new().unwrap();
        network.api_origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut socket = loop {
                    if let Ok((socket, _)) = listener.accept() { break socket; }
                    assert!(std::time::Instant::now() < deadline, "missing fixture request");
                    std::thread::sleep(Duration::from_millis(10));
                };
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = socket.read(&mut buffer).unwrap();
                    assert!(count > 0); bytes.extend_from_slice(&buffer[..count]);
                    if let Some(index) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..index]);
                        let length: usize = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse().unwrap())).unwrap_or(0);
                        if bytes.len() >= index + 4 + length { break; }
                    }
                }
                let body = response.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).unwrap();
                requests.push(String::from_utf8(bytes).unwrap());
            }
            requests
        });
        (network, server)
    }

    #[test]
    fn connection_check_authenticates_and_only_reads_wiki_document_and_edit_permission() {
        let auth = json!({"code":0,"tenant_access_token":"fixture-token","expire":7200});
        let wiki = json!({"code":0,"data":{"node":{"obj_type":"docx","obj_token":"Target"}}});
        let document = json!({"code":0,"data":{"document":{"title":"Fixture"}}});
        for permission in [json!(true), json!(false), Value::Null] {
            let (mut network, server) = connection_fixture(vec![auth.clone(), wiki.clone(), document.clone(), json!({"code":0,"data":{"auth_result":permission}})]);
            let config = json!({"appId":"fixture-app","appSecret":"fixture-secret","syncMode":"append","targetDocumentUrl":"https://test.feishu.cn/wiki/Wiki"});
            let result = tauri::async_runtime::block_on(network.check_connection(&config));
            match permission.as_bool() {
                Some(true) => { let result = result.unwrap(); assert_eq!(result["scope"], "target"); assert_eq!(result["title"], "Fixture"); assert!(!result.to_string().contains("fixture-token")); },
                Some(false) => assert_eq!(result.unwrap_err().message, "permission"),
                None => assert_eq!(result.unwrap_err().message, "invalid-response"),
            }
            let requests = server.join().unwrap();
            assert!(requests[0].starts_with("POST /auth/v3/tenant_access_token/internal "));
            assert!(requests[1].starts_with("GET /wiki/v2/spaces/get_node?token=Wiki "));
            assert!(requests[2].starts_with("GET /docx/v1/documents/Target "));
            assert!(requests[3].starts_with("GET /drive/v1/permissions/Target/members/auth?type=docx&action=edit "));
            assert!(requests[1..].iter().all(|request| !request.contains("fixture-secret")));
        }
    }

    #[test]
    fn create_mode_connection_check_reports_authentication_only_without_creating_documents() {
        let (mut network, server) = connection_fixture(vec![json!({"code":0,"tenant_access_token":"fixture-token","expire":7200})]);
        let result = tauri::async_runtime::block_on(network.check_connection(&json!({"appId":"fixture-app","appSecret":"fixture-secret","syncMode":"create"}))).unwrap();
        assert_eq!(result["scope"], "authentication");
        assert_eq!(server.join().unwrap().len(), 1);
    }
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

    #[test]
    fn media_upload_requires_a_bound_attachment_and_created_media_block() {
        let note = json!({
            "id":"note",
            "content":"text",
            "attachments":[{"id":"image","name":"a.png","mimeType":"image/png","size":4,"storedPath":"/managed/a.png"}]
        });
        let mut session = new_session(
            &note,
            json!({"appId":"app","syncMode":"create","collaboratorEmail":"user@example.com"}),
        );
        session.documents.insert("Known".into());
        assert!(allowed_request(
            &session,
            "/docx/v1/documents/Known/blocks/Known/children?document_revision_id=1&client_token=abc",
            "POST",
            &json!({"index":-1,"children":[{"block_type":27,"image":{}}]})
        ));
        session
            .media_nodes
            .insert("ImageBlock".into(), "docx_image".into());
        assert!(allowed_request(
            &session,
            "/docx/v1/documents/Known/blocks/ImageBlock?document_revision_id=1&client_token=abc",
            "PATCH",
            &json!({"replace_image":{"token":"uploaded"}})
        ));
        assert!(!allowed_request(
            &session,
            "/docx/v1/documents/Known/blocks/ForeignBlock?document_revision_id=1&client_token=abc",
            "PATCH",
            &json!({"replace_image":{"token":"uploaded"}})
        ));
        assert!(!allowed_request(
            &session,
            "/docx/v1/documents/ForeignDocument/blocks/ImageBlock?document_revision_id=1&client_token=abc",
            "PATCH",
            &json!({"replace_image":{"token":"uploaded"}})
        ));
        assert!(allowed_request(
            &session,
            "/drive/v1/medias/upload_all",
            "POST",
            &json!({"attachment_id":"image","file_name":"a.png","size":4,"parent_type":"docx_image","parent_node":"ImageBlock"})
        ));
        assert!(!allowed_request(
            &session,
            "/drive/v1/medias/upload_all",
            "POST",
            &json!({"attachment_id":"other","file_name":"a.png","size":4,"parent_type":"docx_image","parent_node":"ImageBlock"})
        ));
        assert!(!allowed_request(
            &session,
            "/docx/v1/documents/Known/blocks/ImageBlock?document_revision_id=1&client_token=abc",
            "PATCH",
            &json!({"replace_file":{"token":"wrong-kind"}})
        ));
    }
}
