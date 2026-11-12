//! OpenAI-compatible chat. Every request leaves from Rust, so the webview needs no network access.
//! The API key lives in the macOS Keychain and never reaches `ai.json`, error codes or events.
use crate::fs::{app_data::ensure_dir, atomic_write, bounded_file::read_canonical_parent};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet, HashMap}, io::Read, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewWindow};

const KEYCHAIN_SERVICE: &str = "app.mino.markdown.ai";
const CONFIG_LIMIT_BYTES: u64 = 16 * 1024;
const MAX_BASE_URL_CHARS: usize = 300;
const MAX_MODEL_CHARS: usize = 100;
const MAX_KEY_CHARS: usize = 400;
const MAX_MESSAGES: usize = 64;
const MAX_CONTENT_BYTES: usize = 600 * 1024;
const MAX_CONCURRENT: usize = 4;
const MAX_SSE_LINE_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_MODELS: usize = 500;
const MAX_MODELS_BYTES: usize = 1024 * 1024;
const POLL: Duration = Duration::from_millis(20);

static CONFIG_LOCK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------------------------------------
// Configuration

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct AiConfig {
    schema_version: u32,
    enabled: bool,
    consented: bool,
    provider: String,
    base_url: String,
    model: String,
    /// The address and model of providers that are not selected, so that switching back restores them.
    /// A provider that is still on its defaults has no entry, and files written before this field read as empty.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    providers: BTreeMap<String, ProviderMemory>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
struct ProviderMemory {
    base_url: String,
    model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self { schema_version: 1, enabled: false, consented: false, provider: "deepseek".into(), base_url: "https://api.deepseek.com/v1".into(), model: "deepseek-chat".into(), providers: BTreeMap::new() }
    }
}

/// Which providers have a key stored. The keys themselves never leave the secret store.
#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
pub struct KeyStatus {
    deepseek: bool,
    openai: bool,
    custom: bool,
}

#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    #[serde(flatten)]
    config: AiConfig,
    /// Whether the selected provider has a key.
    has_key: bool,
    keys: KeyStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiConfigPatch {
    enabled: Option<bool>,
    consented: Option<bool>,
    provider: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
}

fn is_provider(id: &str) -> bool { matches!(id, "deepseek" | "openai" | "custom") }

/// The base URL and model a provider starts with. `custom` has none and keeps what is configured.
fn provider_defaults(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "deepseek" => Some(("https://api.deepseek.com/v1", "deepseek-chat")),
        "openai" => Some(("https://api.openai.com/v1", "gpt-4o-mini")),
        _ => None,
    }
}

fn is_loopback(url: &Url) -> bool { matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")) }

/// Accepts `https://…`, and `http://…` only for loopback hosts. User info, queries and fragments are rejected.
fn parse_base_url(raw: &str) -> Option<Url> {
    if raw.is_empty() || raw.chars().count() > MAX_BASE_URL_CHARS || raw.chars().any(|c| !c.is_ascii_graphic() || c == '\\') { return None; }
    let lower = raw.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") { return None; }
    let url = Url::parse(raw).ok()?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() { return None; }
    if url.host_str().is_none_or(str::is_empty) { return None; }
    match url.scheme() {
        "https" => Some(url),
        "http" if is_loopback(&url) => Some(url),
        _ => None,
    }
}

fn valid_model(model: &str) -> bool {
    (1..=MAX_MODEL_CHARS).contains(&model.len()) && model.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'/' | b'-'))
}

fn valid(config: &AiConfig) -> bool {
    config.schema_version == 1 && is_provider(&config.provider) && parse_base_url(&config.base_url).is_some() && valid_model(&config.model)
        && config.providers.iter().all(|(id, memory)| is_provider(id) && parse_base_url(&memory.base_url).is_some() && valid_model(&memory.model))
}

fn apply_patch(current: &AiConfig, patch: serde_json::Value) -> Result<AiConfig, String> {
    let patch: AiConfigPatch = serde_json::from_value(patch).map_err(|_| "AI_INVALID_CONFIG")?;
    let mut next = current.clone();
    if let Some(enabled) = patch.enabled { next.enabled = enabled; }
    if let Some(consented) = patch.consented { next.consented = consented; }
    if let Some(provider) = patch.provider {
        if provider != next.provider {
            if !is_provider(&provider) { return Err("AI_INVALID_CONFIG".into()); }
            // The provider being left keeps its address and model for the next time it is selected.
            let leaving = std::mem::replace(&mut next.provider, provider);
            if provider_defaults(&leaving) == Some((next.base_url.as_str(), next.model.as_str())) { next.providers.remove(&leaving); }
            else { next.providers.insert(leaving, ProviderMemory { base_url: next.base_url.clone(), model: next.model.clone() }); }
            // The new one returns to what it was last set to, or starts from its own defaults, unless the
            // same patch names the values. `custom` has no defaults and starts from the current values.
            if let Some(memory) = next.providers.remove(&next.provider) {
                next.base_url = memory.base_url;
                next.model = memory.model;
            } else if let Some((base_url, model)) = provider_defaults(&next.provider) {
                next.base_url = base_url.into();
                next.model = model.into();
            }
        }
    }
    if let Some(base_url) = patch.base_url { next.base_url = base_url.trim().into(); }
    if let Some(model) = patch.model { next.model = model.trim().into(); }
    if valid(&next) { Ok(next) } else { Err("AI_INVALID_CONFIG".into()) }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> { Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join("ai.json")) }

/// A missing, oversized, linked, corrupt or invalid file reads as the defaults, which keep AI off.
fn read_at(path: &Path) -> AiConfig {
    let Ok(bytes) = read_canonical_parent(path, CONFIG_LIMIT_BYTES) else { return AiConfig::default() };
    match serde_json::from_slice::<AiConfig>(&bytes) {
        Ok(config) if valid(&config) => config,
        _ => AiConfig::default(),
    }
}

fn write_at(path: &Path, config: &AiConfig) -> Result<(), String> {
    if !valid(config) { return Err("AI_INVALID_CONFIG".into()); }
    let bytes = serde_json::to_vec(config).map_err(|_| "IO_ERROR")?;
    atomic_write::replace_record(path, &bytes, CONFIG_LIMIT_BYTES)
}

fn update_at(path: &Path, patch: serde_json::Value) -> Result<AiConfig, String> {
    let _lock = CONFIG_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let next = apply_patch(&read_at(path), patch)?;
    write_at(path, &next)?;
    Ok(next)
}

// ---------------------------------------------------------------------------------------------
// Secrets

/// Where API keys are kept, one per provider id. Failures are reported as `AI_KEYCHAIN`.
pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    /// Reports whether a secret exists without reading it.
    fn has(&self, account: &str) -> bool;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// Generic passwords in the user's login keychain.
#[cfg(target_os = "macos")]
struct KeychainStore { service: &'static str }

#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        security_framework::passwords::set_generic_password(self.service, account, secret.as_bytes()).map_err(|_| "AI_KEYCHAIN".into())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match security_framework::passwords::get_generic_password(self.service, account) {
            Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| "AI_KEYCHAIN".into()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(_) => Err("AI_KEYCHAIN".into()),
        }
    }
    fn has(&self, account: &str) -> bool {
        use security_framework::item::{ItemClass, ItemSearchOptions};
        // Asking for attributes only never shows a keychain prompt, unlike reading the password.
        ItemSearchOptions::new().class(ItemClass::generic_password()).service(self.service).account(account).load_attributes(true).limit(1).search().is_ok_and(|found| !found.is_empty())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(self.service, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err("AI_KEYCHAIN".into()),
        }
    }
}

/// Keeps secrets for the life of the process only. Tests use it, and so do platforms without a keychain.
#[cfg(any(test, not(target_os = "macos")))]
#[derive(Default)]
struct MemoryStore(Mutex<HashMap<String, String>>);

#[cfg(any(test, not(target_os = "macos")))]
impl SecretStore for MemoryStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0.lock().map_err(|_| "AI_KEYCHAIN")?.insert(account.into(), secret.into());
        Ok(())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> { Ok(self.0.lock().map_err(|_| "AI_KEYCHAIN")?.get(account).cloned()) }
    fn has(&self, account: &str) -> bool { self.0.lock().is_ok_and(|secrets| secrets.contains_key(account)) }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().map_err(|_| "AI_KEYCHAIN")?.remove(account);
        Ok(())
    }
}

/// A key is trimmed and must be 1–400 printable ASCII characters.
fn clean_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > MAX_KEY_CHARS || !key.bytes().all(|b| (0x20..=0x7e).contains(&b)) { return Err("AI_INVALID_KEY".into()); }
    Ok(key)
}

fn view(config: AiConfig, secrets: &dyn SecretStore) -> AiConfigView {
    let keys = KeyStatus { deepseek: secrets.has("deepseek"), openai: secrets.has("openai"), custom: secrets.has("custom") };
    let has_key = match config.provider.as_str() { "deepseek" => keys.deepseek, "openai" => keys.openai, _ => keys.custom };
    AiConfigView { config, has_key, keys }
}

/// The keychain account a key command works on: the named provider, or the selected one.
fn key_account(config: &AiConfig, provider: Option<&str>) -> Result<String, String> {
    match provider {
        None => Ok(config.provider.clone()),
        Some(id) if is_provider(id) => Ok(id.into()),
        Some(_) => Err("AI_INVALID_CONFIG".into()),
    }
}

fn store_key(config: AiConfig, secrets: &dyn SecretStore, provider: Option<&str>, key: &str) -> Result<AiConfigView, String> {
    let account = key_account(&config, provider)?;
    secrets.set(&account, clean_key(key)?)?;
    Ok(view(config, secrets))
}

fn remove_key(config: AiConfig, secrets: &dyn SecretStore, provider: Option<&str>) -> Result<AiConfigView, String> {
    secrets.delete(&key_account(&config, provider)?)?;
    Ok(view(config, secrets))
}

// ---------------------------------------------------------------------------------------------
// In-flight requests

pub struct AiState {
    secrets: Box<dyn SecretStore>,
    requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for AiState {
    fn default() -> Self {
        #[cfg(target_os = "macos")]
        let secrets: Box<dyn SecretStore> = Box::new(KeychainStore { service: KEYCHAIN_SERVICE });
        #[cfg(not(target_os = "macos"))]
        let secrets: Box<dyn SecretStore> = Box::new(MemoryStore::default());
        Self { secrets, requests: Mutex::new(HashMap::new()) }
    }
}

/// Keeps a request registered until it is dropped.
struct Ticket<'a> {
    state: &'a AiState,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl Drop for Ticket<'_> {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.state.requests.lock() { requests.remove(&self.id); }
    }
}

impl AiState {
    /// Registers a request so that `ai_cancel` can reach it. An id that is already in flight is refused.
    fn begin(&self, id: &str) -> Result<Ticket<'_>, String> {
        let mut requests = self.requests.lock().map_err(|_| "AI_BUSY")?;
        if requests.contains_key(id) { return Err("AI_INVALID_REQUEST".into()); }
        let cancel = Arc::new(AtomicBool::new(false));
        requests.insert(id.into(), cancel.clone());
        Ok(Ticket { state: self, id: id.into(), cancel })
    }
    fn active(&self) -> usize { self.requests.lock().map(|requests| requests.len()).unwrap_or(usize::MAX) }
    fn cancel(&self, id: &str) -> bool {
        let Ok(requests) = self.requests.lock() else { return false };
        requests.get(id).map(|cancel| cancel.store(true, Ordering::SeqCst)).is_some()
    }
}

// ---------------------------------------------------------------------------------------------
// Chat

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    request_id: String,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct WireBody<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Clone, Copy)]
struct Timing {
    /// The longest a DNS lookup or a TCP connect may take.
    connect: Duration,
    /// The longest the server may stay silent, before or during the response.
    idle: Duration,
    /// Deltas that arrive within this window are delivered together.
    flush: Duration,
}

const TIMING: Timing = Timing { connect: Duration::from_secs(15), idle: Duration::from_secs(60), flush: Duration::from_millis(30) };

struct ChatCall {
    base_url: String,
    model: String,
    key: Option<String>,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
}

fn valid_request_id(id: &str) -> bool { (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }

fn valid_shape(request: &ChatRequest) -> bool {
    request.messages.iter().all(|message| matches!(message.role.as_str(), "system" | "user" | "assistant"))
        && request.temperature.is_none_or(|value| value.is_finite() && (0.0..=2.0).contains(&value))
}

fn too_large(messages: &[ChatMessage]) -> bool {
    messages.is_empty() || messages.len() > MAX_MESSAGES || messages.iter().map(|message| message.content.len()).sum::<usize>() > MAX_CONTENT_BYTES
}

/// Reads server-sent events from arbitrary byte chunks. Only whole lines are decoded, so a chunk may end
/// in the middle of a line or of a multi-byte character.
#[derive(Default)]
struct SseParser {
    line: Vec<u8>,
    saw_data: bool,
    done: bool,
}

impl SseParser {
    /// Appends the text of every finished delta to `out`. Returns true once `[DONE]` has been read.
    fn feed(&mut self, bytes: &[u8], out: &mut String) -> Result<bool, String> {
        for piece in bytes.split_inclusive(|byte| *byte == b'\n') {
            if self.done { break; }
            if self.line.len() + piece.len() > MAX_SSE_LINE_BYTES { return Err("AI_BAD_RESPONSE".into()); }
            self.line.extend_from_slice(piece);
            if self.line.last() == Some(&b'\n') {
                let line = std::mem::take(&mut self.line);
                self.take_line(&line, out)?;
            }
        }
        Ok(self.done)
    }
    /// Handles the end of the body. A body without a single event is not a chat stream.
    fn finish(&mut self, out: &mut String) -> Result<(), String> {
        if !self.done && !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            self.take_line(&line, out)?;
        }
        if self.done || self.saw_data { Ok(()) } else { Err("AI_BAD_RESPONSE".into()) }
    }
    fn take_line(&mut self, line: &[u8], out: &mut String) -> Result<(), String> {
        let line = line.strip_suffix(b"\n").unwrap_or(line);
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        // Blank lines end an event and lines that start with a colon are comments.
        if line.is_empty() || line[0] == b':' { return Ok(()); }
        let line = std::str::from_utf8(line).map_err(|_| "AI_BAD_RESPONSE")?;
        let Some(data) = line.strip_prefix("data:") else { return Ok(()) };
        let data = data.trim();
        if data.is_empty() { return Ok(()); }
        if data == "[DONE]" { self.done = true; return Ok(()); }
        let value: serde_json::Value = serde_json::from_str(data).map_err(|_| "AI_BAD_RESPONSE")?;
        if !value.is_object() || value.get("error").is_some_and(|error| !error.is_null()) { return Err("AI_BAD_RESPONSE".into()); }
        self.saw_data = true;
        if let Some(text) = value.pointer("/choices/0/delta/content").and_then(|content| content.as_str()) { out.push_str(text); }
        Ok(())
    }
}

enum Wire {
    Bytes(Vec<u8>),
    End,
    Fail(String),
}

/// Sets a flag when dropped, which tells the HTTP thread to stop once the caller has returned.
struct StopOnDrop(Arc<AtomicBool>);
impl Drop for StopOnDrop {
    fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); }
}

fn transport_code(error: &ureq::Error) -> &'static str {
    match error {
        ureq::Error::Protocol(_) | ureq::Error::Http(_) | ureq::Error::BodyExceedsLimit(_) => "AI_BAD_RESPONSE",
        _ => "AI_NETWORK",
    }
}

/// The one way requests are made: no redirects, bounded waits, system certificates, and no proxy for loopback.
/// `total` bounds a whole request; a chat stream has no such bound because an answer may take minutes.
fn http_agent(loopback: bool, timing: Timing, total: Option<Duration>) -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let mut config = ureq::Agent::config_builder()
        .http_status_as_error(false)
        // Redirects are never followed, so the key cannot travel to another host.
        .max_redirects(0)
        .user_agent("Mino")
        .timeout_global(total)
        .timeout_resolve(Some(timing.connect))
        .timeout_connect(Some(timing.connect))
        .timeout_send_request(Some(timing.idle))
        .timeout_send_body(Some(timing.idle))
        .timeout_recv_response(Some(timing.idle))
        .timeout_per_read(Some(timing.idle))
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build());
    if loopback { config = config.proxy(None); }
    config.build().into()
}

/// Sends the request and forwards the raw response body. Runs on its own thread because socket reads block.
fn http_worker(endpoint: &str, loopback: bool, key: Option<&str>, body: &[u8], timing: Timing, stop: &AtomicBool, sender: &mpsc::SyncSender<Wire>) -> Result<(), String> {
    let agent = http_agent(loopback, timing, None);
    let mut request = agent.post(endpoint).header("Content-Type", "application/json").header("Accept", "text/event-stream");
    if let Some(key) = key { request = request.header("Authorization", format!("Bearer {key}")); }
    let response = request.send(body).map_err(|error| transport_code(&error))?;
    let status = response.status().as_u16();
    // The body of a failed response is dropped unread: it may quote the key or the prompt.
    if !(200..300).contains(&status) { return Err(format!("AI_HTTP_{status}")); }
    let mut reader = response.into_body().into_reader();
    let mut buffer = [0u8; 8192];
    let mut total = 0usize;
    loop {
        if stop.load(Ordering::SeqCst) { return Ok(()); }
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(count) => {
                total += count;
                if total > MAX_RESPONSE_BYTES { return Err("AI_BAD_RESPONSE".into()); }
                if sender.send(Wire::Bytes(buffer[..count].to_vec())).is_err() { return Ok(()); }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err("AI_NETWORK".into()),
        }
    }
}

/// Streams one chat completion and hands the reply text to `sink` in order. Needs no Tauri runtime.
/// Returns as soon as `cancel` is set, even while the socket is silent.
fn stream_chat(call: ChatCall, timing: Timing, cancel: &AtomicBool, sink: &mut dyn FnMut(&str)) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) { return Err("AI_CANCELLED".into()); }
    let url = parse_base_url(&call.base_url).ok_or("AI_INVALID_CONFIG")?;
    let loopback = is_loopback(&url);
    // The normalized form is sent, so the host that was validated is the host that is contacted.
    let endpoint = format!("{}/chat/completions", url.as_str().trim_end_matches('/'));
    let body = serde_json::to_vec(&WireBody { model: &call.model, messages: &call.messages, stream: true, temperature: call.temperature }).map_err(|_| "AI_BAD_RESPONSE")?;
    let key = call.key;
    let stop = Arc::new(AtomicBool::new(false));
    let _stop_on_return = StopOnDrop(stop.clone());
    let (sender, receiver) = mpsc::sync_channel::<Wire>(32);
    std::thread::Builder::new().name("mino-ai-http".into()).spawn(move || {
        let last = match http_worker(&endpoint, loopback, key.as_deref(), &body, timing, &stop, &sender) { Ok(()) => Wire::End, Err(code) => Wire::Fail(code) };
        let _ = sender.send(last);
    }).map_err(|_| "AI_NETWORK")?;

    let mut parser = SseParser::default();
    let mut pending = String::new();
    let mut last_flush = Instant::now();
    let mut last_activity = Instant::now();
    // The HTTP thread enforces the real timeouts. This one only covers a thread that never reports back.
    let silence_limit = timing.connect * 2 + timing.idle * 2;
    loop {
        if cancel.load(Ordering::SeqCst) { return Err("AI_CANCELLED".into()); }
        let outcome = match receiver.recv_timeout(POLL) {
            Ok(Wire::Bytes(bytes)) => {
                last_activity = Instant::now();
                match parser.feed(&bytes, &mut pending) { Ok(true) => Some(Ok(())), Ok(false) => None, Err(code) => Some(Err(code)) }
            }
            Ok(Wire::End) => Some(parser.finish(&mut pending)),
            Ok(Wire::Fail(code)) => Some(Err(code)),
            Err(mpsc::RecvTimeoutError::Timeout) => if last_activity.elapsed() > silence_limit { Some(Err("AI_NETWORK".into())) } else { None },
            Err(mpsc::RecvTimeoutError::Disconnected) => Some(Err("AI_NETWORK".into())),
        };
        if !pending.is_empty() && (outcome.is_some() || last_flush.elapsed() >= timing.flush) {
            sink(&pending);
            pending.clear();
            last_flush = Instant::now();
        }
        if let Some(result) = outcome { return result; }
    }
}

/// The gates every network request passes, in their documented order. Returns the key to send, if any.
fn check_access(config: &AiConfig, secrets: &dyn SecretStore) -> Result<Option<String>, String> {
    if !config.enabled { return Err("AI_DISABLED".into()); }
    if !config.consented { return Err("AI_NO_CONSENT".into()); }
    let loopback = parse_base_url(&config.base_url).is_some_and(|url| is_loopback(&url));
    let key = match secrets.get(&config.provider) {
        Ok(key) => key,
        // A local model needs no key, so a keychain that cannot be read does not stop it.
        Err(_) if loopback => None,
        Err(code) => return Err(code),
    };
    if key.is_none() && !loopback { return Err("AI_NO_KEY".into()); }
    Ok(key)
}

/// The gates of a chat: those of every request, then the size of the messages.
fn check_gates(config: &AiConfig, secrets: &dyn SecretStore, messages: &[ChatMessage]) -> Result<Option<String>, String> {
    let key = check_access(config, secrets)?;
    if too_large(messages) { return Err("AI_TOO_LARGE".into()); }
    Ok(key)
}

/// Reads the ids out of an OpenAI-style model list: sorted, without repeats, and only ids a config accepts.
fn parse_models(body: &[u8]) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_slice(body).map_err(|_| "AI_BAD_RESPONSE")?;
    let data = value.get("data").and_then(|data| data.as_array()).ok_or("AI_BAD_RESPONSE")?;
    let ids: BTreeSet<&str> = data.iter().filter_map(|model| model.get("id")?.as_str()).filter(|id| valid_model(id)).collect();
    Ok(ids.into_iter().take(MAX_MODELS).map(str::to_owned).collect())
}

/// Asks the service which models it offers. Only the key is sent; no document content is involved.
fn fetch_models(base_url: &str, key: Option<&str>, timing: Timing) -> Result<Vec<String>, String> {
    let url = parse_base_url(base_url).ok_or("AI_INVALID_CONFIG")?;
    let endpoint = format!("{}/models", url.as_str().trim_end_matches('/'));
    let agent = http_agent(is_loopback(&url), timing, Some(timing.connect + timing.idle));
    let mut request = agent.get(&endpoint).header("Accept", "application/json");
    if let Some(key) = key { request = request.header("Authorization", format!("Bearer {key}")); }
    let response = request.call().map_err(|error| transport_code(&error))?;
    let status = response.status().as_u16();
    // As with chat, the body of a failed response is dropped unread.
    if !(200..300).contains(&status) { return Err(format!("AI_HTTP_{status}")); }
    let mut body = Vec::new();
    response.into_body().into_reader().take(MAX_MODELS_BYTES as u64 + 1).read_to_end(&mut body).map_err(|_| "AI_NETWORK")?;
    if body.len() > MAX_MODELS_BYTES { return Err("AI_BAD_RESPONSE".into()); }
    parse_models(&body)
}

/// The whole of `ai_list_models` apart from reading the config file.
fn list_models(config: &AiConfig, secrets: &dyn SecretStore, timing: Timing) -> Result<Vec<String>, String> {
    let key = check_access(config, secrets)?;
    fetch_models(&config.base_url, key.as_deref(), timing)
}

/// The whole of `ai_chat` apart from reading the config file and emitting events.
fn run_chat(config: &AiConfig, state: &AiState, ticket: &Ticket, request: ChatRequest, timing: Timing, sink: &mut dyn FnMut(&str)) -> Result<(), String> {
    if !valid_shape(&request) { return Err("AI_INVALID_REQUEST".into()); }
    let key = check_gates(config, state.secrets.as_ref(), &request.messages)?;
    if state.active() > MAX_CONCURRENT { return Err("AI_BUSY".into()); }
    let call = ChatCall { base_url: config.base_url.clone(), model: config.model.clone(), key, messages: request.messages, temperature: request.temperature };
    stream_chat(call, timing, &ticket.cancel, sink)
}

// ---------------------------------------------------------------------------------------------
// Commands

fn publish(app: &AppHandle, view: AiConfigView) -> AiConfigView {
    let _ = app.emit("ai-config-changed", &view);
    view
}

#[tauri::command(async)]
pub fn ai_get_config(app: AppHandle, window: WebviewWindow, state: tauri::State<AiState>) -> Result<AiConfigView, String> {
    crate::require_workspace_window(&window)?;
    Ok(view(read_at(&path(&app)?), state.secrets.as_ref()))
}

#[tauri::command(async)]
pub fn ai_set_config(app: AppHandle, window: WebviewWindow, state: tauri::State<AiState>, patch: serde_json::Value) -> Result<AiConfigView, String> {
    crate::require_workspace_window(&window)?;
    let next = update_at(&path(&app)?, patch)?;
    Ok(publish(&app, view(next, state.secrets.as_ref())))
}

#[tauri::command(async)]
pub fn ai_set_key(app: AppHandle, window: WebviewWindow, state: tauri::State<AiState>, key: String, provider: Option<String>) -> Result<AiConfigView, String> {
    crate::require_workspace_window(&window)?;
    let saved = store_key(read_at(&path(&app)?), state.secrets.as_ref(), provider.as_deref(), &key)?;
    Ok(publish(&app, saved))
}

#[tauri::command(async)]
pub fn ai_clear_key(app: AppHandle, window: WebviewWindow, state: tauri::State<AiState>, provider: Option<String>) -> Result<AiConfigView, String> {
    crate::require_workspace_window(&window)?;
    let cleared = remove_key(read_at(&path(&app)?), state.secrets.as_ref(), provider.as_deref())?;
    Ok(publish(&app, cleared))
}

/// The model ids the selected provider offers, sorted. Passes the same gates as a chat and sends no document content.
#[tauri::command(async)]
pub fn ai_list_models(app: AppHandle, window: WebviewWindow, state: tauri::State<AiState>) -> Result<Vec<String>, String> {
    crate::require_workspace_window(&window)?;
    list_models(&read_at(&path(&app)?), state.secrets.as_ref(), TIMING)
}

fn chat_blocking(app: &AppHandle, label: &str, request: serde_json::Value) -> Result<(), String> {
    // Nothing is emitted for these two failures: the id is unusable, or it belongs to a stream that is still running.
    let request: ChatRequest = serde_json::from_value(request).map_err(|_| "AI_INVALID_REQUEST")?;
    if !valid_request_id(&request.request_id) { return Err("AI_INVALID_REQUEST".into()); }
    let state = app.state::<AiState>();
    let ticket = state.begin(&request.request_id)?;
    let id = request.request_id.clone();
    let result = path(app).and_then(|file| {
        let config = read_at(&file);
        run_chat(&config, &state, &ticket, request, TIMING, &mut |text| {
            let _ = app.emit_to(label, "ai-stream", serde_json::json!({ "requestId": id, "kind": "delta", "text": text }));
        })
    });
    drop(ticket);
    let _ = match &result {
        Ok(()) => app.emit_to(label, "ai-stream", serde_json::json!({ "requestId": id, "kind": "done" })),
        Err(code) => app.emit_to(label, "ai-stream", serde_json::json!({ "requestId": id, "kind": "error", "code": code })),
    };
    result
}

/// Resolves when the stream has ended. The reply itself arrives through `ai-stream` events.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, window: WebviewWindow, request: serde_json::Value) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let label = window.label().to_owned();
    // A stream can last minutes, so it runs on the blocking pool and leaves the command threads free.
    tauri::async_runtime::spawn_blocking(move || chat_blocking(&app, &label, request)).await.map_err(|_| "AI_NETWORK".to_string())?
}

/// Stops a running request. An id that is not in flight is ignored.
#[tauri::command(async)]
pub fn ai_cancel(window: WebviewWindow, state: tauri::State<AiState>, request_id: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    state.cancel(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write, net::{TcpListener, TcpStream}, thread};

    const FAST: Timing = Timing { connect: Duration::from_secs(3), idle: Duration::from_secs(5), flush: Duration::ZERO };
    const SSE_HEAD: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
    const SECRET: &str = "sk-test-SECRET-0123456789";

    /// Serves one connection on an ephemeral loopback port and returns the base URL that reaches it.
    fn serve(handler: impl FnOnce(TcpStream) + Send + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || { if let Ok((stream, _)) = listener.accept() { handler(stream); } });
        format!("http://127.0.0.1:{port}/v1")
    }

    /// Reads one HTTP request and returns its head and body.
    fn read_request(stream: &mut TcpStream) -> (String, String) {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        let head_end = loop {
            if let Some(at) = bytes.windows(4).position(|window| window == b"\r\n\r\n") { break at + 4; }
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0, "request ended early");
            bytes.extend_from_slice(&buffer[..count]);
        };
        let head = String::from_utf8(bytes[..head_end].to_vec()).unwrap();
        let length: usize = head.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse().unwrap())).unwrap_or(0);
        while bytes.len() < head_end + length {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0, "body ended early");
            bytes.extend_from_slice(&buffer[..count]);
        }
        (head, String::from_utf8(bytes[head_end..head_end + length].to_vec()).unwrap())
    }

    /// Writes each piece as its own TCP segment so the client sees the chosen chunk boundaries.
    fn write_pieces(stream: &mut TcpStream, pieces: &[&[u8]]) {
        stream.set_nodelay(true).unwrap();
        for piece in pieces {
            stream.write_all(piece).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(15));
        }
    }

    fn delta(text: &str) -> String { format!("data: {}\n\n", serde_json::json!({ "id": "c1", "choices": [{ "index": 0, "delta": { "content": text } }] })) }
    fn message(role: &str, content: &str) -> ChatMessage { ChatMessage { role: role.into(), content: content.into() } }
    fn call(base_url: &str, key: Option<&str>) -> ChatCall {
        ChatCall { base_url: base_url.into(), model: "deepseek-chat".into(), key: key.map(str::to_owned), messages: vec![message("system", "简洁回答"), message("user", "你好")], temperature: None }
    }
    fn collect(call: ChatCall, timing: Timing, cancel: &AtomicBool) -> (Result<(), String>, Vec<String>) {
        let mut deltas = Vec::new();
        let result = stream_chat(call, timing, cancel, &mut |text| deltas.push(text.to_owned()));
        (result, deltas)
    }
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mino-ai-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }
    fn patch(current: &AiConfig, value: serde_json::Value) -> Result<AiConfig, String> { apply_patch(current, value) }
    fn memory_state() -> AiState { AiState { secrets: Box::new(MemoryStore::default()), requests: Mutex::new(HashMap::new()) } }
    fn ready_config(base_url: &str) -> AiConfig {
        AiConfig { schema_version: 1, enabled: true, consented: true, provider: "custom".into(), base_url: base_url.into(), model: "local-model".into(), providers: BTreeMap::new() }
    }
    fn request(messages: Vec<ChatMessage>) -> ChatRequest { ChatRequest { request_id: "r1".into(), messages, temperature: None } }
    fn run(config: &AiConfig, state: &AiState, request: ChatRequest) -> (Result<(), String>, String) {
        let ticket = state.begin(&request.request_id).unwrap();
        let mut text = String::new();
        let result = run_chat(config, state, &ticket, request, FAST, &mut |delta| text.push_str(delta));
        (result, text)
    }

    #[test]
    fn sse_parser_survives_any_chunk_boundary() {
        let body = format!(": keep-alive\r\n\r\nevent: message\r\ndata: {{\"choices\":[{{\"delta\":{{\"role\":\"assistant\"}}}}]}}\r\n\r\n{}data:{{\"choices\":[{{\"delta\":{{\"content\":\"，世界 🌏\"}}}}]}}\r\n\r\ndata: {{\"choices\":[],\"usage\":{{\"total_tokens\":3}}}}\n\ndata: [DONE]\n\ndata: {{\"choices\":[{{\"delta\":{{\"content\":\"ignored\"}}}}]}}\n\n", delta("你好"));
        for size in [1, 2, 3, 5, 7, 64, body.len()] {
            let mut parser = SseParser::default();
            let mut text = String::new();
            let mut done = false;
            for chunk in body.as_bytes().chunks(size) { done = parser.feed(chunk, &mut text).unwrap(); }
            assert!(done, "chunk size {size}");
            parser.finish(&mut text).unwrap();
            assert_eq!(text, "你好，世界 🌏", "chunk size {size}");
        }
    }

    #[test]
    fn sse_parser_accepts_a_body_that_ends_without_done_and_rejects_non_streams() {
        let mut parser = SseParser::default();
        let mut text = String::new();
        // The last line has no line break before the body ends.
        assert_eq!(parser.feed(format!("{}data: {{\"choices\":[{{\"delta\":{{\"content\":\"尾\"}}}}]}}", delta("头")).as_bytes(), &mut text), Ok(false));
        assert_eq!(parser.finish(&mut text), Ok(()));
        assert_eq!(text, "头尾");

        let mut empty = SseParser::default();
        assert_eq!(empty.finish(&mut String::new()), Err("AI_BAD_RESPONSE".into()));
        let mut plain_json = SseParser::default();
        assert_eq!(plain_json.feed(b"{\"choices\":[{\"message\":{\"content\":\"not a stream\"}}]}\n", &mut String::new()), Ok(false));
        assert_eq!(plain_json.finish(&mut String::new()), Err("AI_BAD_RESPONSE".into()));
        let mut malformed = SseParser::default();
        assert_eq!(malformed.feed(b"data: {\"choices\": [\n\n", &mut String::new()), Err("AI_BAD_RESPONSE".into()));
        let mut in_band_error = SseParser::default();
        assert_eq!(in_band_error.feed(b"data: {\"error\":{\"message\":\"overloaded\"}}\n\n", &mut String::new()), Err("AI_BAD_RESPONSE".into()));
        let mut bad_utf8 = SseParser::default();
        assert_eq!(bad_utf8.feed(b"data: \xff\xfe\n", &mut String::new()), Err("AI_BAD_RESPONSE".into()));
        let mut only_done = SseParser::default();
        assert_eq!(only_done.feed(b"data: [DONE]\n", &mut String::new()), Ok(true));
        assert_eq!(only_done.finish(&mut String::new()), Ok(()));
    }

    #[test]
    fn stream_assembles_deltas_in_order_across_split_utf8_and_crlf() {
        let base = serve(|mut stream| {
            read_request(&mut stream);
            let first = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\n".as_bytes();
            let split = first.windows(3).position(|window| window == "你".as_bytes()).unwrap() + 1;
            let second = delta("，世界");
            let third = "data: {\"choices\":[{\"delta\":{\"content\":\"！\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), b": ping\r\n\r\nda", &first[2..split], &first[split..], &second.as_bytes()[..9], &second.as_bytes()[9..], third.as_bytes()]);
        });
        let (result, deltas) = collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false));
        assert_eq!(result, Ok(()));
        assert_eq!(deltas.concat(), "你好，世界！");
        assert!(deltas.len() >= 2, "{deltas:?}");
        assert!(deltas.iter().all(|text| !text.is_empty()));
    }

    #[test]
    fn small_deltas_are_coalesced() {
        let base = serve(|mut stream| {
            read_request(&mut stream);
            let body: String = (0..40).map(|index| delta(&index.to_string())).collect();
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), body.as_bytes(), b"data: [DONE]\n\n"]);
        });
        let timing = Timing { flush: Duration::from_millis(30), ..FAST };
        let (result, deltas) = collect(call(&base, None), timing, &AtomicBool::new(false));
        assert_eq!(result, Ok(()));
        assert_eq!(deltas.concat(), (0..40).map(|index| index.to_string()).collect::<String>());
        assert!(deltas.len() < 10, "{}", deltas.len());
    }

    #[test]
    fn request_carries_bearer_key_model_stream_flag_and_messages() {
        let (sender, receiver) = mpsc::channel();
        let base = serve(move |mut stream| {
            sender.send(read_request(&mut stream)).unwrap();
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), delta("ok").as_bytes(), b"data: [DONE]\n\n"]);
        });
        let mut with_temperature = call(&format!("{base}/"), Some(SECRET));
        with_temperature.temperature = Some(0.7);
        let (result, deltas) = collect(with_temperature, FAST, &AtomicBool::new(false));
        assert_eq!((result, deltas.concat().as_str()), (Ok(()), "ok"));
        let (head, body) = receiver.recv().unwrap();
        assert!(head.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"), "{head}");
        let head = head.to_ascii_lowercase();
        assert!(head.contains(&format!("\r\nauthorization: bearer {}\r\n", SECRET.to_ascii_lowercase())), "{head}");
        assert!(head.contains("\r\ncontent-type: application/json\r\n"));
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body, serde_json::json!({ "model": "deepseek-chat", "stream": true, "temperature": 0.7, "messages": [{ "role": "system", "content": "简洁回答" }, { "role": "user", "content": "你好" }] }));

        // Without a key or a temperature, neither the header nor the field is sent.
        let (sender, receiver) = mpsc::channel();
        let base = serve(move |mut stream| {
            sender.send(read_request(&mut stream)).unwrap();
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), b"data: [DONE]\n\n"]);
        });
        assert_eq!(collect(call(&base, None), FAST, &AtomicBool::new(false)), (Ok(()), vec![]));
        let (head, body) = receiver.recv().unwrap();
        assert!(!head.to_ascii_lowercase().contains("authorization"));
        assert!(serde_json::from_str::<serde_json::Value>(&body).unwrap().get("temperature").is_none());
    }

    #[test]
    fn http_401_reports_only_the_status() {
        let base = serve(|mut stream| {
            read_request(&mut stream);
            let body = format!("{{\"error\":{{\"message\":\"Incorrect API key provided: {SECRET}\"}}}}");
            write_pieces(&mut stream, &[format!("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()]);
        });
        let (result, deltas) = collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false));
        assert_eq!(result, Err("AI_HTTP_401".into()));
        assert!(deltas.is_empty());
    }

    #[test]
    fn redirects_are_reported_and_not_followed() {
        let followed = Arc::new(AtomicBool::new(false));
        let seen = followed.clone();
        let other = serve(move |_| seen.store(true, Ordering::SeqCst));
        let base = serve(move |mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: {other}/chat/completions\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()]);
        });
        let (result, deltas) = collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false));
        assert_eq!(result, Err("AI_HTTP_307".into()));
        assert!(deltas.is_empty());
        thread::sleep(Duration::from_millis(100));
        assert!(!followed.load(Ordering::SeqCst));
    }

    #[test]
    fn refused_connection_is_a_network_error() {
        let port = { let listener = TcpListener::bind("127.0.0.1:0").unwrap(); listener.local_addr().unwrap().port() };
        let (result, deltas) = collect(call(&format!("http://127.0.0.1:{port}/v1"), Some(SECRET)), FAST, &AtomicBool::new(false));
        assert_eq!(result, Err("AI_NETWORK".into()));
        assert!(deltas.is_empty());
    }

    #[test]
    fn silent_server_times_out_as_a_network_error() {
        let (release, hold) = mpsc::channel::<()>();
        let base = serve(move |mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), delta("开始").as_bytes()]);
            let _ = hold.recv();
        });
        let started = Instant::now();
        let timing = Timing { idle: Duration::from_millis(300), ..FAST };
        let (result, deltas) = collect(call(&base, None), timing, &AtomicBool::new(false));
        assert_eq!(result, Err("AI_NETWORK".into()));
        assert_eq!(deltas.concat(), "开始");
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        drop(release);
    }

    #[test]
    fn cancel_mid_stream_stops_promptly() {
        let (release, hold) = mpsc::channel::<()>();
        let base = serve(move |mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), delta("第一段").as_bytes()]);
            // Keeps the socket open and silent, as a slow model would.
            let _ = hold.recv();
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let (first_delta, seen) = mpsc::channel();
        let canceller = { let cancel = cancel.clone(); thread::spawn(move || { seen.recv().unwrap(); let at = Instant::now(); cancel.store(true, Ordering::SeqCst); at }) };
        let mut deltas = Vec::new();
        let result = stream_chat(call(&base, Some(SECRET)), FAST, &cancel, &mut |text| { deltas.push(text.to_owned()); let _ = first_delta.send(()); });
        let returned = Instant::now();
        let cancelled_at = canceller.join().unwrap();
        assert_eq!(result, Err("AI_CANCELLED".into()));
        assert_eq!(deltas.concat(), "第一段");
        assert!(returned.duration_since(cancelled_at) < Duration::from_millis(200), "{:?}", returned.duration_since(cancelled_at));
        drop(release);

        // A request that was cancelled before it started never opens a connection.
        assert_eq!(collect(call("https://api.deepseek.com/v1", Some(SECRET)), FAST, &AtomicBool::new(true)), (Err("AI_CANCELLED".into()), vec![]));
    }

    #[test]
    fn malformed_stream_is_a_bad_response() {
        let base = serve(|mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), delta("前").as_bytes(), b"data: {\"choices\":[{\"delta\":\n\n"]);
        });
        let (result, deltas) = collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false));
        assert_eq!(result, Err("AI_BAD_RESPONSE".into()));
        assert_eq!(deltas.concat(), "前");

        let base = serve(|mut stream| {
            read_request(&mut stream);
            let body = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"not streamed\"}}]}";
            write_pieces(&mut stream, &[format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()]);
        });
        assert_eq!(collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false)), (Err("AI_BAD_RESPONSE".into()), vec![]));

        let base = serve(|mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[b"this is not http\r\n\r\n"]);
        });
        let (result, _) = collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false));
        assert!(matches!(result.as_ref().map_err(String::as_str), Err("AI_BAD_RESPONSE" | "AI_NETWORK")), "{result:?}");
    }

    #[test]
    fn gates_are_checked_in_order() {
        let state = memory_state();
        let remote = ready_config("https://api.example.com/v1");
        let hello = || request(vec![message("user", "hi")]);

        let mut config = remote.clone();
        config.enabled = false;
        config.consented = false;
        assert_eq!(run(&config, &state, request(vec![])).0, Err("AI_DISABLED".into()));
        config.enabled = true;
        assert_eq!(run(&config, &state, request(vec![])).0, Err("AI_NO_CONSENT".into()));
        // No key is stored yet, and that is reported before the size of the request.
        assert_eq!(run(&remote, &state, request(vec![])).0, Err("AI_NO_KEY".into()));
        assert_eq!(run(&remote, &state, hello()).0, Err("AI_NO_KEY".into()));

        state.secrets.set("custom", SECRET).unwrap();
        assert_eq!(run(&remote, &state, request(vec![])).0, Err("AI_TOO_LARGE".into()));
        assert_eq!(run(&remote, &state, request(vec![message("user", "x"); MAX_MESSAGES + 1])).0, Err("AI_TOO_LARGE".into()));
        assert_eq!(run(&remote, &state, request(vec![message("user", &"x".repeat(MAX_CONTENT_BYTES / 2)), message("user", &"x".repeat(MAX_CONTENT_BYTES / 2 + 1))])).0, Err("AI_TOO_LARGE".into()));
        assert!(!too_large(&[message("user", &"x".repeat(MAX_CONTENT_BYTES))]));
        assert!(!too_large(&vec![message("user", "x"); MAX_MESSAGES]));

        // The key of another provider does not count.
        let mut other = remote.clone();
        other.provider = "openai".into();
        assert_eq!(run(&other, &state, hello()).0, Err("AI_NO_KEY".into()));

        assert_eq!(run(&remote, &state, request(vec![message("tool", "x")])).0, Err("AI_INVALID_REQUEST".into()));
        let mut hot = hello();
        hot.temperature = Some(f32::NAN);
        assert_eq!(run(&remote, &state, hot).0, Err("AI_INVALID_REQUEST".into()));
        assert!(state.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn loopback_endpoint_runs_without_a_key() {
        let base = serve(|mut stream| {
            let (head, _) = read_request(&mut stream);
            assert!(!head.to_ascii_lowercase().contains("authorization"));
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), delta("本地模型").as_bytes(), b"data: [DONE]\n\n"]);
        });
        let state = memory_state();
        assert_eq!(run(&ready_config(&base), &state, request(vec![message("user", "hi")])), (Ok(()), "本地模型".into()));
    }

    #[test]
    fn requests_are_tracked_cancelled_capped_and_released() {
        let state = memory_state();
        let first = state.begin("a").unwrap();
        assert_eq!(state.begin("a").err(), Some("AI_INVALID_REQUEST".into()));
        assert!(state.cancel("a"));
        assert!(first.cancel.load(Ordering::SeqCst));
        assert!(!state.cancel("missing"));
        drop(first);
        assert_eq!(state.active(), 0);
        assert!(!state.cancel("a"));

        // Four requests may run. A fifth is refused once it has passed the other gates.
        state.secrets.set("custom", SECRET).unwrap();
        let config = ready_config("https://api.example.com/v1");
        let running: Vec<_> = ["r1", "r2", "r3", "r4"].iter().map(|id| state.begin(id).unwrap()).collect();
        let fifth = state.begin("r5").unwrap();
        assert_eq!(run_chat(&config, &state, &fifth, ChatRequest { request_id: "r5".into(), messages: vec![message("user", "hi")], temperature: None }, FAST, &mut |_| {}), Err("AI_BUSY".into()));
        let mut disabled = config.clone();
        disabled.enabled = false;
        assert_eq!(run_chat(&disabled, &state, &fifth, request(vec![message("user", "hi")]), FAST, &mut |_| {}), Err("AI_DISABLED".into()));
        drop(fifth);
        drop(running);
        assert_eq!(state.active(), 0);

        for id in ["a", "A-b_9", &"x".repeat(64)] { assert!(valid_request_id(id), "{id}"); }
        for id in ["", "a b", "a.b", "请求", &"x".repeat(65)] { assert!(!valid_request_id(id), "{id}"); }
    }

    #[test]
    fn base_url_validation_table() {
        let long_ok = format!("https://h.example/{}", "a".repeat(MAX_BASE_URL_CHARS - 18));
        let long_bad = format!("{long_ok}a");
        for url in ["https://api.deepseek.com/v1", "https://api.openai.com/v1", "https://example.com", "https://example.com:8443/openai/v1/", "HTTPS://Example.com/v1", "http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://LOCALHOST/v1", "http://[::1]:8080/v1", "https://127.0.0.1/v1", long_ok.as_str()] {
            assert!(parse_base_url(url).is_some(), "{url}");
        }
        for url in ["", "api.deepseek.com/v1", "http://api.deepseek.com/v1", "http://192.168.1.10:11434/v1", "http://127.0.0.2/v1", "http://localhost.evil.com/v1", "http://127.0.0.1.evil.com/v1", "http://[::2]/v1", "https://user@example.com/v1", "https://user:pass@example.com/v1", "https://:pass@example.com/v1", "http://127.0.0.1@evil.com/v1", "http://evil.com\\@127.0.0.1/v1", "https://example.com/v1?key=1", "https://example.com/v1?", "https://example.com/v1#frag", "https://example.com/v1#", "ftp://example.com/v1", "file:///etc/passwd", "javascript:alert(1)", "https://", "https://exa mple.com/v1", " https://example.com/v1", "https://example.com/v1\n", "https://例子.com/v1", long_bad.as_str()] {
            assert!(parse_base_url(url).is_none(), "{url}");
        }
        assert!(is_loopback(&parse_base_url("http://127.0.0.1:1/v1").unwrap()));
        assert!(is_loopback(&parse_base_url("https://localhost/v1").unwrap()));
        assert!(is_loopback(&parse_base_url("http://[::1]/v1").unwrap()));
        assert!(!is_loopback(&parse_base_url("https://api.openai.com/v1").unwrap()));
        for model in ["deepseek-chat", "gpt-4o-mini", "qwen2.5:7b", "org/model_v1.2", &"m".repeat(MAX_MODEL_CHARS)] { assert!(valid_model(model), "{model}"); }
        for model in ["", "gpt 4", "模型", "a\"b", "a\n", &"m".repeat(MAX_MODEL_CHARS + 1)] { assert!(!valid_model(model), "{model}"); }
    }

    #[test]
    fn config_round_trips_and_bad_files_read_as_defaults() {
        let dir = temp_dir("config");
        let file = dir.join("ai.json");
        let defaults = AiConfig::default();
        assert_eq!(serde_json::to_value(&defaults).unwrap(), serde_json::json!({ "schemaVersion": 1, "enabled": false, "consented": false, "provider": "deepseek", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat" }));
        assert_eq!(read_at(&file), defaults);

        let saved = update_at(&file, serde_json::json!({ "enabled": true, "consented": true, "provider": "custom", "baseUrl": " http://127.0.0.1:11434/v1 ", "model": "qwen2.5:7b" })).unwrap();
        assert_eq!(saved, AiConfig { schema_version: 1, enabled: true, consented: true, provider: "custom".into(), base_url: "http://127.0.0.1:11434/v1".into(), model: "qwen2.5:7b".into(), providers: BTreeMap::new() });
        assert_eq!(read_at(&file), saved);
        // A second write replaces the first and a rejected patch leaves the file alone.
        assert_eq!(update_at(&file, serde_json::json!({ "enabled": false })).unwrap().model, "qwen2.5:7b");
        assert_eq!(update_at(&file, serde_json::json!({ "baseUrl": "http://example.com/v1" })), Err("AI_INVALID_CONFIG".into()));
        assert_eq!(read_at(&file), AiConfig { enabled: false, ..saved.clone() });

        for corrupt in [&b"broken"[..], b"", b"[]", b"null", br#"{"schemaVersion":2,"enabled":true,"consented":true}"#, br#"{"schemaVersion":1,"enabled":true,"consented":true,"provider":"other"}"#, br#"{"schemaVersion":1,"enabled":true,"consented":true,"baseUrl":"http://example.com/v1"}"#, br#"{"schemaVersion":1,"enabled":"yes"}"#] {
            fs::write(&file, corrupt).unwrap();
            assert_eq!(read_at(&file), defaults, "{}", String::from_utf8_lossy(corrupt));
        }
        // Fields a file leaves out take their defaults.
        fs::write(&file, br#"{"schemaVersion":1,"enabled":true}"#).unwrap();
        assert_eq!(read_at(&file), AiConfig { enabled: true, ..defaults.clone() });
        fs::write(&file, vec![b' '; CONFIG_LIMIT_BYTES as usize + 1]).unwrap();
        assert_eq!(read_at(&file), defaults);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn linked_config_is_ignored() {
        let dir = temp_dir("link");
        fs::write(dir.join("outside.json"), br#"{"schemaVersion":1,"enabled":true,"consented":true}"#).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.json"), dir.join("ai.json")).unwrap();
        assert_eq!(read_at(&dir.join("ai.json")), AiConfig::default());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn provider_switch_starts_from_defaults_and_remembers_each_provider() {
        let defaults = AiConfig::default();
        let openai = patch(&defaults, serde_json::json!({ "provider": "openai" })).unwrap();
        assert_eq!((openai.provider.as_str(), openai.base_url.as_str(), openai.model.as_str()), ("openai", "https://api.openai.com/v1", "gpt-4o-mini"));
        let tuned = patch(&openai, serde_json::json!({ "model": "gpt-4.1", "baseUrl": "https://proxy.example.com/v1" })).unwrap();
        assert_eq!((tuned.provider.as_str(), tuned.base_url.as_str(), tuned.model.as_str()), ("openai", "https://proxy.example.com/v1", "gpt-4.1"));
        // Naming the provider that is already selected changes nothing.
        assert_eq!(patch(&tuned, serde_json::json!({ "provider": "openai" })).unwrap(), tuned);
        // Custom has no defaults, so the first switch to it keeps the current values.
        let custom = patch(&tuned, serde_json::json!({ "provider": "custom" })).unwrap();
        assert_eq!((custom.provider.as_str(), custom.base_url.as_str(), custom.model.as_str()), ("custom", "https://proxy.example.com/v1", "gpt-4.1"));
        let deepseek = patch(&custom, serde_json::json!({ "provider": "deepseek" })).unwrap();
        assert_eq!((deepseek.base_url.as_str(), deepseek.model.as_str()), ("https://api.deepseek.com/v1", "deepseek-chat"));
        // A value named in the same patch wins and the other one is still reset.
        let mixed = patch(&tuned, serde_json::json!({ "provider": "deepseek", "model": "deepseek-reasoner" })).unwrap();
        assert_eq!((mixed.base_url.as_str(), mixed.model.as_str()), ("https://api.deepseek.com/v1", "deepseek-reasoner"));
        let both = patch(&defaults, serde_json::json!({ "provider": "openai", "baseUrl": "http://localhost:8080/v1", "model": "local" })).unwrap();
        assert_eq!((both.base_url.as_str(), both.model.as_str()), ("http://localhost:8080/v1", "local"));
        let consent = patch(&defaults, serde_json::json!({ "enabled": true, "consented": true })).unwrap();
        assert_eq!(consent, AiConfig { enabled: true, consented: true, ..defaults.clone() });

        // Each provider comes back as it was left: DeepSeek → OpenAI → DeepSeek → OpenAI.
        let memory = |base_url: &str, model: &str| ProviderMemory { base_url: base_url.into(), model: model.into() };
        let reasoner = patch(&defaults, serde_json::json!({ "model": "deepseek-reasoner" })).unwrap();
        let first_openai = patch(&reasoner, serde_json::json!({ "provider": "openai" })).unwrap();
        assert_eq!((first_openai.base_url.as_str(), first_openai.model.as_str()), ("https://api.openai.com/v1", "gpt-4o-mini"));
        assert_eq!(first_openai.providers, BTreeMap::from([("deepseek".to_owned(), memory("https://api.deepseek.com/v1", "deepseek-reasoner"))]));
        let gpt = patch(&first_openai, serde_json::json!({ "model": "gpt-4.1" })).unwrap();
        let back = patch(&gpt, serde_json::json!({ "provider": "deepseek" })).unwrap();
        assert_eq!((back.provider.as_str(), back.base_url.as_str(), back.model.as_str()), ("deepseek", "https://api.deepseek.com/v1", "deepseek-reasoner"));
        assert_eq!(back.providers, BTreeMap::from([("openai".to_owned(), memory("https://api.openai.com/v1", "gpt-4.1"))]));
        let again = patch(&back, serde_json::json!({ "provider": "openai" })).unwrap();
        assert_eq!((again.base_url.as_str(), again.model.as_str()), ("https://api.openai.com/v1", "gpt-4.1"));
        // The custom address and model come back too, and a provider left on its defaults leaves no entry.
        let local = patch(&again, serde_json::json!({ "provider": "custom", "baseUrl": "http://127.0.0.1:11434/v1", "model": "qwen2.5:7b" })).unwrap();
        let away = patch(&local, serde_json::json!({ "provider": "deepseek" })).unwrap();
        assert_eq!(away.model, "deepseek-reasoner");
        assert_eq!(away.providers.keys().collect::<Vec<_>>(), ["custom", "openai"]);
        let home = patch(&away, serde_json::json!({ "provider": "custom" })).unwrap();
        assert_eq!((home.base_url.as_str(), home.model.as_str()), ("http://127.0.0.1:11434/v1", "qwen2.5:7b"));
        let plain = patch(&patch(&defaults, serde_json::json!({ "provider": "openai" })).unwrap(), serde_json::json!({ "provider": "deepseek" })).unwrap();
        assert_eq!(plain, defaults);
        // A value named with the switch wins over what was remembered.
        let named = patch(&back, serde_json::json!({ "provider": "openai", "model": "gpt-4o" })).unwrap();
        assert_eq!((named.base_url.as_str(), named.model.as_str()), ("https://api.openai.com/v1", "gpt-4o"));
        // Any model id of the accepted shape can be set, whether or not it is a suggestion.
        assert_eq!(patch(&defaults, serde_json::json!({ "model": "ft:gpt-4o:org/custom_v2.1" })).unwrap().model, "ft:gpt-4o:org/custom_v2.1");
        // What is remembered cannot be written directly.
        assert_eq!(patch(&defaults, serde_json::json!({ "providers": { "openai": { "baseUrl": "https://evil.example/v1", "model": "m" } } })), Err("AI_INVALID_CONFIG".into()));

        for bad in [serde_json::json!({ "provider": "claude" }), serde_json::json!({ "baseUrl": "http://example.com/v1" }), serde_json::json!({ "baseUrl": "https://u:p@example.com/v1" }), serde_json::json!({ "model": "" }), serde_json::json!({ "model": "has space" }), serde_json::json!({ "enabled": "yes" }), serde_json::json!({ "schemaVersion": 2 }), serde_json::json!({ "apiKey": SECRET }), serde_json::json!({ "hasKey": true }), serde_json::json!([]), serde_json::json!("x")] {
            assert_eq!(patch(&defaults, bad.clone()), Err("AI_INVALID_CONFIG".into()), "{bad}");
        }
    }

    #[test]
    fn remembered_providers_are_saved_and_older_files_still_read() {
        let dir = temp_dir("memory");
        let file = dir.join("ai.json");
        // A file written before providers were remembered.
        fs::write(&file, br#"{"schemaVersion":1,"enabled":true,"consented":true,"provider":"openai","baseUrl":"https://api.openai.com/v1","model":"gpt-4o"}"#).unwrap();
        let old = read_at(&file);
        assert_eq!((old.enabled, old.provider.as_str(), old.model.as_str()), (true, "openai", "gpt-4o"));
        assert!(old.providers.is_empty());

        let deepseek = update_at(&file, serde_json::json!({ "provider": "deepseek" })).unwrap();
        assert_eq!(deepseek.model, "deepseek-chat");
        assert_eq!(read_at(&file), deepseek);
        let stored: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(stored, serde_json::json!({ "schemaVersion": 1, "enabled": true, "consented": true, "provider": "deepseek", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat", "providers": { "openai": { "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o" } } }));
        assert_eq!(update_at(&file, serde_json::json!({ "provider": "openai" })).unwrap().model, "gpt-4o");
        // With every provider back on its defaults the field is not written at all.
        update_at(&file, serde_json::json!({ "model": "gpt-4o-mini" })).unwrap();
        update_at(&file, serde_json::json!({ "provider": "deepseek" })).unwrap();
        assert!(!String::from_utf8(fs::read(&file).unwrap()).unwrap().contains("providers"));

        // A remembered entry is held to the same rules as the selected one.
        for bad in [r#"{"other":{"baseUrl":"https://example.com/v1","model":"m"}}"#, r#"{"openai":{"baseUrl":"http://example.com/v1","model":"m"}}"#, r#"{"openai":{"baseUrl":"https://example.com/v1","model":"has space"}}"#, r#"{"openai":{"model":"m"}}"#, r#"["openai"]"#] {
            fs::write(&file, format!(r#"{{"schemaVersion":1,"enabled":true,"consented":true,"providers":{bad}}}"#)).unwrap();
            assert_eq!(read_at(&file), AiConfig::default(), "{bad}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keys_are_set_cleared_and_reported_per_provider() {
        let state = memory_state();
        let secrets = state.secrets.as_ref();
        let config = AiConfig::default();
        let status = |shown: &AiConfigView| (shown.has_key, shown.keys.deepseek, shown.keys.openai, shown.keys.custom);
        assert_eq!(status(&view(config.clone(), secrets)), (false, false, false, false));

        // A key can be saved for a provider that is not selected.
        let shown = store_key(config.clone(), secrets, Some("openai"), &format!(" {SECRET} ")).unwrap();
        assert_eq!(status(&shown), (false, false, true, false));
        assert_eq!(secrets.get("openai"), Ok(Some(SECRET.into())));
        assert_eq!(secrets.get("deepseek"), Ok(None));
        // Without a provider the selected one is meant.
        let shown = store_key(config.clone(), secrets, None, "sk-deepseek-key").unwrap();
        assert_eq!(status(&shown), (true, true, true, false));
        assert_eq!(secrets.get("deepseek"), Ok(Some("sk-deepseek-key".into())));
        let shown = store_key(config.clone(), secrets, Some("custom"), "local-key").unwrap();
        assert_eq!(status(&shown), (true, true, true, true));

        // `hasKey` follows the selected provider.
        let openai = patch(&config, serde_json::json!({ "provider": "openai" })).unwrap();
        let shown = remove_key(openai.clone(), secrets, Some("deepseek")).unwrap();
        assert_eq!(status(&shown), (true, false, true, true));
        let shown = remove_key(openai.clone(), secrets, None).unwrap();
        assert_eq!(status(&shown), (false, false, false, true));
        assert_eq!(secrets.get("custom"), Ok(Some("local-key".into())));
        // Clearing a key that is not there is not an error.
        assert_eq!(status(&remove_key(openai.clone(), secrets, Some("openai")).unwrap()), (false, false, false, true));

        // An unknown provider or a bad key changes nothing.
        assert_eq!(store_key(config.clone(), secrets, Some("claude"), SECRET), Err("AI_INVALID_CONFIG".into()));
        assert_eq!(store_key(config.clone(), secrets, Some(""), SECRET), Err("AI_INVALID_CONFIG".into()));
        assert_eq!(remove_key(config.clone(), secrets, Some("../custom")), Err("AI_INVALID_CONFIG".into()));
        assert_eq!(store_key(config.clone(), secrets, Some("openai"), "  "), Err("AI_INVALID_KEY".into()));
        assert_eq!(status(&view(config.clone(), secrets)), (false, false, false, true));

        // The view names which keys exist and never what they are.
        store_key(config.clone(), secrets, Some("openai"), SECRET).unwrap();
        let shown = serde_json::to_string(&view(openai, secrets)).unwrap();
        assert!(shown.contains(r#""hasKey":true,"keys":{"deepseek":false,"openai":true,"custom":true}"#), "{shown}");
        assert!(!shown.contains(SECRET) && !shown.contains("local-key"));
    }

    fn json_response(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    /// A base URL whose server only records that something connected.
    fn tripwire() -> (String, Arc<AtomicBool>) {
        let touched = Arc::new(AtomicBool::new(false));
        let seen = touched.clone();
        (serve(move |_| seen.store(true, Ordering::SeqCst)), touched)
    }

    #[test]
    fn model_list_is_fetched_with_the_key_and_cleaned_up() {
        let (sender, receiver) = mpsc::channel();
        let base = serve(move |mut stream| {
            sender.send(read_request(&mut stream)).unwrap();
            let body = serde_json::json!({ "object": "list", "data": [
                { "id": "gpt-4o", "object": "model" }, { "id": "deepseek-chat" }, { "id": "gpt-4o" }, { "id": "has space" }, { "id": "模型" }, { "id": "" },
                { "id": "m".repeat(MAX_MODEL_CHARS + 1) }, { "id": 7 }, { "name": "no-id" }, "text", null, { "id": "Qwen/Qwen2.5-7B:free" }, { "id": "deepseek-reasoner" },
            ] }).to_string();
            write_pieces(&mut stream, &[json_response("200 OK", &body).as_bytes()]);
        });
        let state = memory_state();
        state.secrets.set("custom", SECRET).unwrap();
        // The key of another provider is not the one that is sent.
        state.secrets.set("openai", "sk-other-provider").unwrap();
        let models = list_models(&ready_config(&format!("{base}/")), state.secrets.as_ref(), FAST).unwrap();
        assert_eq!(models, ["Qwen/Qwen2.5-7B:free", "deepseek-chat", "deepseek-reasoner", "gpt-4o"]);
        let (head, body) = receiver.recv().unwrap();
        assert!(head.starts_with("GET /v1/models HTTP/1.1\r\n"), "{head}");
        assert!(body.is_empty());
        let head = head.to_ascii_lowercase();
        assert!(head.contains(&format!("\r\nauthorization: bearer {}\r\n", SECRET.to_ascii_lowercase())), "{head}");
        assert!(!head.contains("sk-other-provider"));

        // A local service is asked without a key.
        let base = serve(|mut stream| {
            let (head, _) = read_request(&mut stream);
            assert!(!head.to_ascii_lowercase().contains("authorization"));
            write_pieces(&mut stream, &[json_response("200 OK", r#"{"data":[]}"#).as_bytes()]);
        });
        assert_eq!(list_models(&ready_config(&base), memory_state().secrets.as_ref(), FAST), Ok(vec![]));
    }

    #[test]
    fn model_list_is_capped() {
        let many: Vec<_> = (0..MAX_MODELS + 20).map(|index| serde_json::json!({ "id": format!("model-{index:04}") })).collect();
        let models = parse_models(serde_json::json!({ "data": many }).to_string().as_bytes()).unwrap();
        assert_eq!(models.len(), MAX_MODELS);
        assert_eq!((models[0].as_str(), models[MAX_MODELS - 1].as_str()), ("model-0000", "model-0499"));

        // A body over the size limit is refused whole.
        let base = serve(|mut stream| {
            read_request(&mut stream);
            let body = format!(r#"{{"data":[{{"id":"m"}}],"padding":"{}"}}"#, "x".repeat(MAX_MODELS_BYTES));
            let _ = stream.write_all(json_response("200 OK", &body).as_bytes());
        });
        assert_eq!(fetch_models(&base, None, FAST), Err("AI_BAD_RESPONSE".into()));
    }

    #[test]
    fn model_list_gates_are_checked_in_order_before_any_connection() {
        let state = memory_state();
        let secrets = state.secrets.as_ref();
        // Loopback, so only the first two gates can refuse it.
        let (base, touched) = tripwire();
        let mut config = ready_config(&base);
        config.enabled = false;
        config.consented = false;
        assert_eq!(list_models(&config, secrets, FAST), Err("AI_DISABLED".into()));
        config.enabled = true;
        assert_eq!(list_models(&config, secrets, FAST), Err("AI_NO_CONSENT".into()));
        thread::sleep(Duration::from_millis(100));
        assert!(!touched.load(Ordering::SeqCst));

        // A remote service needs the key of its own provider. `.invalid` never resolves, so nothing could be sent anyway.
        let mut remote = ready_config("https://models.invalid/v1");
        remote.enabled = false;
        remote.consented = false;
        assert_eq!(list_models(&remote, secrets, FAST), Err("AI_DISABLED".into()));
        remote.enabled = true;
        assert_eq!(list_models(&remote, secrets, FAST), Err("AI_NO_CONSENT".into()));
        remote.consented = true;
        assert_eq!(list_models(&remote, secrets, FAST), Err("AI_NO_KEY".into()));
        secrets.set("openai", SECRET).unwrap();
        assert_eq!(list_models(&remote, secrets, FAST), Err("AI_NO_KEY".into()));
        // An address that is not allowed is refused before a connection as well.
        assert_eq!(fetch_models("http://example.com/v1", Some(SECRET), FAST), Err("AI_INVALID_CONFIG".into()));
    }

    #[test]
    fn model_list_failures_are_fixed_codes() {
        let base = serve(|mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[json_response("401 Unauthorized", &format!("{{\"error\":{{\"message\":\"Incorrect API key provided: {SECRET}\"}}}}")).as_bytes()]);
        });
        assert_eq!(fetch_models(&base, Some(SECRET), FAST), Err("AI_HTTP_401".into()));

        for body in ["not json", "", "[]", "null", r#"{"models":[{"id":"m"}]}"#, r#"{"data":{"id":"m"}}"#, r#"{"data":[{"id":"m"}"#, r#"{"error":{"message":"overloaded"}}"#] {
            let base = serve(move |mut stream| {
                read_request(&mut stream);
                write_pieces(&mut stream, &[json_response("200 OK", body).as_bytes()]);
            });
            assert_eq!(fetch_models(&base, Some(SECRET), FAST), Err("AI_BAD_RESPONSE".into()), "{body}");
        }

        let (other, followed) = tripwire();
        let base = serve(move |mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[format!("HTTP/1.1 302 Found\r\nLocation: {other}/models\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()]);
        });
        assert_eq!(fetch_models(&base, Some(SECRET), FAST), Err("AI_HTTP_302".into()));
        thread::sleep(Duration::from_millis(100));
        assert!(!followed.load(Ordering::SeqCst));

        let closed = { let listener = TcpListener::bind("127.0.0.1:0").unwrap(); format!("http://127.0.0.1:{}/v1", listener.local_addr().unwrap().port()) };
        assert_eq!(fetch_models(&closed, Some(SECRET), FAST), Err("AI_NETWORK".into()));

        // A server that accepts and then says nothing is given up on.
        let (release, hold) = mpsc::channel::<()>();
        let base = serve(move |mut stream| { read_request(&mut stream); let _ = hold.recv(); });
        let started = Instant::now();
        assert_eq!(fetch_models(&base, None, Timing { idle: Duration::from_millis(300), ..FAST }), Err("AI_NETWORK".into()));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        drop(release);
    }

    #[test]
    fn key_is_validated_and_never_leaves_the_secret_store() {
        assert_eq!(clean_key(&format!("  {SECRET}\n")), Ok(SECRET));
        assert_eq!(clean_key(&"k".repeat(MAX_KEY_CHARS)).map(str::len), Ok(MAX_KEY_CHARS));
        for bad in ["", "   ", "sk-密钥", "sk-a\tb", "sk-a\u{7f}", &"k".repeat(MAX_KEY_CHARS + 1)] {
            assert_eq!(clean_key(bad), Err("AI_INVALID_KEY".into()), "{bad:?}");
        }

        let dir = temp_dir("key");
        let file = dir.join("ai.json");
        let state = memory_state();
        let config = update_at(&file, serde_json::json!({ "enabled": true, "consented": true })).unwrap();
        assert!(!view(config.clone(), state.secrets.as_ref()).has_key);
        state.secrets.set(&config.provider, clean_key(SECRET).unwrap()).unwrap();
        let shown = view(read_at(&file), state.secrets.as_ref());
        assert!(shown.has_key);
        let shown = serde_json::to_string(&shown).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&shown).unwrap(), serde_json::json!({ "schemaVersion": 1, "enabled": true, "consented": true, "provider": "deepseek", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat", "hasKey": true, "keys": { "deepseek": true, "openai": false, "custom": false } }));
        assert!(!shown.contains(SECRET));
        assert!(!String::from_utf8(fs::read(&file).unwrap()).unwrap().contains(SECRET));
        // Each provider has its own key.
        let openai = update_at(&file, serde_json::json!({ "provider": "openai" })).unwrap();
        assert!(!view(openai, state.secrets.as_ref()).has_key);
        assert_eq!(state.secrets.get("deepseek"), Ok(Some(SECRET.into())));
        state.secrets.delete("deepseek").unwrap();
        state.secrets.delete("deepseek").unwrap();
        assert_eq!(state.secrets.get("deepseek"), Ok(None));
        fs::remove_dir_all(dir).unwrap();

        // Every failure a request can end in is a fixed code, with or without a server that echoes the key.
        let echo = serve(|mut stream| {
            read_request(&mut stream);
            let body = format!("bad key {SECRET}");
            write_pieces(&mut stream, &[format!("HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()]);
        });
        let garbled = serve(|mut stream| {
            read_request(&mut stream);
            write_pieces(&mut stream, &[SSE_HEAD.as_bytes(), format!("data: {{\"key\": \"{SECRET}\n\n").as_bytes()]);
        });
        let closed = { let listener = TcpListener::bind("127.0.0.1:0").unwrap(); format!("http://127.0.0.1:{}/v1", listener.local_addr().unwrap().port()) };
        let mut codes = Vec::new();
        for base in [echo, garbled, closed] {
            let (result, deltas) = collect(call(&base, Some(SECRET)), FAST, &AtomicBool::new(false));
            assert!(deltas.iter().all(|text| !text.contains(SECRET)));
            codes.push(result.unwrap_err());
        }
        assert_eq!(codes, ["AI_HTTP_500", "AI_BAD_RESPONSE", "AI_NETWORK"]);
    }

    /// Exercises the real login keychain under a throwaway service name, so it only runs when asked for:
    /// `cargo test --lib --manifest-path src-tauri/Cargo.toml keychain_store -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "writes to the login keychain"]
    fn keychain_store_round_trips() {
        let store = KeychainStore { service: "app.mino.markdown.ai.selftest" };
        let account = format!("selftest-{}", std::process::id());
        store.delete(&account).unwrap();
        assert!(!store.has(&account));
        assert_eq!(store.get(&account), Ok(None));
        store.set(&account, "first").unwrap();
        store.set(&account, SECRET).unwrap();
        assert!(store.has(&account));
        assert_eq!(store.get(&account), Ok(Some(SECRET.into())));
        store.delete(&account).unwrap();
        store.delete(&account).unwrap();
        assert!(!store.has(&account));
        assert_eq!(store.get(&account), Ok(None));
    }
}
