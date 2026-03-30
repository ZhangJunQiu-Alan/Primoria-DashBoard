use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, BufWriter},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use cookie_store::CookieStore;
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, ORIGIN, REFERER, USER_AGENT},
    Client,
};
use reqwest_cookie_store::CookieStoreMutex;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const NETEASE_BASE_URL: &str = "https://music.163.com";
const NETEASE_REFERER: &str = "https://music.163.com/";
const NETEASE_ORIGIN: &str = "https://music.163.com";
const NETEASE_LOGIN_URL_PREFIX: &str = "https://music.163.com/login?codekey=";
const NETEASE_COOKIE_FILE: &str = "netease-cookies.json";
const NETEASE_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const SONG_DETAIL_BATCH_SIZE: usize = 200;

struct AppState {
    netease: NetEaseClient,
}

struct NetEaseClient {
    client: Client,
    cookie_store: Arc<CookieStoreMutex>,
    cookie_path: PathBuf,
}

impl NetEaseClient {
    fn new(cookie_path: PathBuf) -> Result<Self, String> {
        let cookie_store = Arc::new(CookieStoreMutex::new(load_cookie_store(&cookie_path)?));

        let mut headers = HeaderMap::new();
        headers.insert(REFERER, HeaderValue::from_static(NETEASE_REFERER));
        headers.insert(ORIGIN, HeaderValue::from_static(NETEASE_ORIGIN));
        headers.insert(USER_AGENT, HeaderValue::from_static(NETEASE_USER_AGENT));
        headers.insert(ACCEPT, HeaderValue::from_static("application/json, text/plain, */*"));

        let client = Client::builder()
            .default_headers(headers)
            .cookie_provider(cookie_store.clone())
            .build()
            .map_err(|err| format!("failed to build NetEase client: {err}"))?;

        Ok(Self {
            client,
            cookie_store,
            cookie_path,
        })
    }

    async fn restore_session(&self) -> Result<NetEaseSessionSnapshot, String> {
        let Some(profile) = self.fetch_account_profile().await? else {
            return Ok(NetEaseSessionSnapshot {
                status: "login-required".to_string(),
                profile: None,
                liked_playlist: None,
                message: Some("请先使用网易云音乐 App 扫码登录".to_string()),
            });
        };

        let liked_playlist = self.fetch_liked_playlist_summary(profile.user_id).await?;

        Ok(NetEaseSessionSnapshot {
            status: "authorized".to_string(),
            profile: Some(profile),
            liked_playlist,
            message: None,
        })
    }

    async fn start_qr_login(&self) -> Result<NetEaseQrLoginStart, String> {
        let response: QrUnikeyResponse = self
            .post_form_json("/api/login/qrcode/unikey", &[("type", "1")])
            .await?;

        if response.code != 200 {
            return Err(response
                .message
                .unwrap_or_else(|| "网易云二维码初始化失败".to_string()));
        }

        let key = response
            .unikey
            .ok_or_else(|| "网易云二维码 key 缺失".to_string())?;

        Ok(NetEaseQrLoginStart {
            key: key.clone(),
            login_url: format!("{NETEASE_LOGIN_URL_PREFIX}{key}"),
        })
    }

    async fn poll_qr_login(&self, key: &str) -> Result<NetEaseQrLoginPoll, String> {
        let response: QrPollResponse = self
            .post_form_json(
                "/api/login/qrcode/client/login",
                &[("key", key), ("type", "1")],
            )
            .await?;

        match response.code {
            801 => Ok(NetEaseQrLoginPoll {
                status: "waiting-scan".to_string(),
                snapshot: None,
                message: Some(response.message.unwrap_or_else(|| "等待扫码".to_string())),
            }),
            802 => Ok(NetEaseQrLoginPoll {
                status: "waiting-confirm".to_string(),
                snapshot: None,
                message: Some(
                    response
                        .message
                        .unwrap_or_else(|| "已扫码，请在网易云 App 确认登录".to_string()),
                ),
            }),
            803 => {
                self.persist_cookies()?;
                let snapshot = self.restore_session().await?;
                Ok(NetEaseQrLoginPoll {
                    status: "authorized".to_string(),
                    snapshot: Some(snapshot),
                    message: Some("网易云登录成功".to_string()),
                })
            }
            800 => Ok(NetEaseQrLoginPoll {
                status: "expired".to_string(),
                snapshot: None,
                message: Some(response.message.unwrap_or_else(|| "二维码已过期".to_string())),
            }),
            _ => Err(response
                .message
                .unwrap_or_else(|| format!("网易云登录状态异常: {}", response.code))),
        }
    }

    async fn fetch_liked_tracks(&self) -> Result<NetEaseLikedTracksPayload, String> {
        let snapshot = self.restore_session().await?;
        if snapshot.status != "authorized" {
            return Err("网易云登录已过期，请重新扫码".to_string());
        }

        let playlist = snapshot
            .liked_playlist
            .clone()
            .ok_or_else(|| "未找到“我喜欢的音乐”歌单".to_string())?;

        let detail: PlaylistDetailResponse = self
            .get_json_with_query(
                "/api/v6/playlist/detail",
                &[
                    ("id", playlist.id.to_string()),
                    ("n", "1000".to_string()),
                    ("s", "0".to_string()),
                ],
            )
            .await?;

        if detail.code != 200 {
            return Err("获取喜欢歌单详情失败".to_string());
        }

        let track_ids: Vec<u64> = detail
            .playlist
            .track_ids
            .into_iter()
            .map(|item| item.id)
            .collect();

        let mut tracks = Vec::with_capacity(track_ids.len());

        for chunk in track_ids.chunks(SONG_DETAIL_BATCH_SIZE) {
            let chunk_tracks = self.fetch_song_detail_batch(chunk).await?;
            tracks.extend(chunk_tracks);
        }

        Ok(NetEaseLikedTracksPayload { playlist, tracks })
    }

    async fn fetch_song_source(&self, song_id: u64) -> Result<NetEaseSongSource, String> {
        let response: SongUrlResponse = self
            .get_json_with_query(
                "/api/song/enhance/player/url/v1",
                &[
                    ("ids", format!("[{song_id}]")),
                    ("level", "standard".to_string()),
                    ("encodeType", "mp3".to_string()),
                ],
            )
            .await?;

        if response.code != 200 {
            return Err("获取网易云播放地址失败".to_string());
        }

        let item = response
            .data
            .into_iter()
            .next()
            .ok_or_else(|| "网易云返回了空播放结果".to_string())?;

        let message = if item.url.is_some() {
            None
        } else {
            Some(infer_song_unavailable_message(&item))
        };
        let url = item.url.map(sanitize_media_url);
        let expires_at = item
            .expi
            .filter(|value| *value > 0)
            .map(|value| now_millis().saturating_add((value as u64) * 1000));

        Ok(NetEaseSongSource {
            song_id,
            url,
            expires_at,
            level: item.level,
            message,
        })
    }

    fn logout(&self) -> Result<(), String> {
        {
            let mut store = self
                .cookie_store
                .lock()
                .map_err(|_| "网易云 cookie store 已损坏".to_string())?;
            *store = CookieStore::default();
        }

        if self.cookie_path.exists() {
            fs::remove_file(&self.cookie_path)
                .map_err(|err| format!("删除网易云 cookie 文件失败: {err}"))?;
        }

        Ok(())
    }

    async fn fetch_account_profile(&self) -> Result<Option<NetEaseProfile>, String> {
        let response: AccountResponse = self.get_json("/api/w/nuser/account/get").await?;

        if response.code != 200 {
            return Err("获取网易云账号信息失败".to_string());
        }

        Ok(response.profile.map(|profile| NetEaseProfile {
            user_id: profile.user_id,
            nickname: profile.nickname,
            avatar_url: profile.avatar_url.map(sanitize_media_url),
        }))
    }

    async fn fetch_liked_playlist_summary(
        &self,
        user_id: u64,
    ) -> Result<Option<NetEasePlaylistSummary>, String> {
        let response: UserPlaylistResponse = self
            .get_json_with_query(
                "/api/user/playlist",
                &[
                    ("uid", user_id.to_string()),
                    ("limit", "1000".to_string()),
                    ("offset", "0".to_string()),
                ],
            )
            .await?;

        if response.code != 200 {
            return Err("获取网易云歌单列表失败".to_string());
        }

        let playlist = response
            .playlist
            .iter()
            .find(|item| item.special_type == 5)
            .cloned()
            .or_else(|| response.playlist.iter().find(|item| item.user_id == user_id).cloned());

        Ok(playlist.map(|item| NetEasePlaylistSummary {
            id: item.id,
            name: item.name,
            cover_img_url: item.cover_img_url.map(sanitize_media_url),
            track_count: item.track_count,
        }))
    }

    async fn fetch_song_detail_batch(&self, ids: &[u64]) -> Result<Vec<NetEaseTrack>, String> {
        let c_payload = serde_json::to_string(
            &ids.iter()
                .map(|id| serde_json::json!({ "id": id }))
                .collect::<Vec<_>>(),
        )
        .map_err(|err| format!("序列化网易云歌曲批次失败: {err}"))?;

        let ids_payload = serde_json::to_string(ids)
            .map_err(|err| format!("序列化网易云歌曲 ID 失败: {err}"))?;

        let response: SongDetailResponse = self
            .post_form_json(
                "/api/v3/song/detail",
                &[("c", c_payload.as_str()), ("ids", ids_payload.as_str())],
            )
            .await?;

        if response.code != 200 {
            return Err("获取网易云歌曲详情失败".to_string());
        }

        let privilege_map: HashMap<u64, SongPrivilege> = response
            .privileges
            .into_iter()
            .map(|item| (item.id, item))
            .collect();
        let order_map: HashMap<u64, usize> = ids
            .iter()
            .enumerate()
            .map(|(index, id)| (*id, index))
            .collect();

        let mut songs: Vec<(usize, NetEaseTrack)> = response
            .songs
            .into_iter()
            .filter_map(|song| {
                let song_id = song.id;
                let order = order_map.get(&song_id).copied()?;
                Some((order, map_song_to_track(song, privilege_map.get(&song_id))))
            })
            .collect();

        songs.sort_by_key(|(order, _)| *order);

        Ok(songs.into_iter().map(|(_, song)| song).collect())
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let response = self
            .client
            .get(format!("{NETEASE_BASE_URL}{path}"))
            .send()
            .await
            .map_err(|err| format!("NetEase GET request failed: {err}"))?;

        decode_json_response(response).await
    }

    async fn get_json_with_query<T: DeserializeOwned, Q: Serialize>(
        &self,
        path: &str,
        query: &Q,
    ) -> Result<T, String> {
        let response = self
            .client
            .get(format!("{NETEASE_BASE_URL}{path}"))
            .query(query)
            .send()
            .await
            .map_err(|err| format!("NetEase GET request failed: {err}"))?;

        decode_json_response(response).await
    }

    async fn post_form_json<T: DeserializeOwned, F: Serialize>(
        &self,
        path: &str,
        form: &F,
    ) -> Result<T, String> {
        let response = self
            .client
            .post(format!("{NETEASE_BASE_URL}{path}"))
            .form(form)
            .send()
            .await
            .map_err(|err| format!("NetEase POST request failed: {err}"))?;

        decode_json_response(response).await
    }

    fn persist_cookies(&self) -> Result<(), String> {
        if let Some(parent) = self.cookie_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建网易云 cookie 目录失败: {err}"))?;
        }

        let file = File::create(&self.cookie_path)
            .map_err(|err| format!("创建网易云 cookie 文件失败: {err}"))?;
        let mut writer = BufWriter::new(file);
        let store = self
            .cookie_store
            .lock()
            .map_err(|_| "网易云 cookie store 已损坏".to_string())?;

        cookie_store::serde::json::save(&store, &mut writer)
            .map_err(|err| format!("保存网易云 cookie 失败: {err}"))
    }
}

fn load_cookie_store(cookie_path: &Path) -> Result<CookieStore, String> {
    if !cookie_path.exists() {
        return Ok(CookieStore::default());
    }

    let file =
        File::open(cookie_path).map_err(|err| format!("打开网易云 cookie 文件失败: {err}"))?;
    let reader = BufReader::new(file);

    cookie_store::serde::json::load(reader).map_err(|err| format!("读取网易云 cookie 失败: {err}"))
}

async fn decode_json_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("读取网易云响应失败: {err}"))?;

    if !status.is_success() {
        return Err(format!("网易云请求失败 ({status}): {body}"));
    }

    serde_json::from_str(&body).map_err(|err| format!("解析网易云响应失败: {err}"))
}

fn map_song_to_track(song: SongDetailSong, privilege: Option<&SongPrivilege>) -> NetEaseTrack {
    let artists: Vec<String> = song.artists.into_iter().map(|artist| artist.name).collect();
    let playable = privilege.map_or(true, |item| {
        item.st == 0
            && (item.pl > 0
                || item
                    .free_trial_privilege
                    .as_ref()
                    .is_some_and(|trial| trial.res_consumable || trial.user_consumable))
    });

    NetEaseTrack {
        id: song.id,
        name: song.name,
        artists: artists.clone(),
        artist_line: artists.join(" / "),
        album_name: song.album.name,
        cover_url: song.album.pic_url.map(sanitize_media_url),
        duration_ms: song.duration_ms,
        playable,
    }
}

fn sanitize_media_url(value: String) -> String {
    value.replace("http://", "https://")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn infer_song_unavailable_message(item: &SongUrlItem) -> String {
    if let Some(message) = item.message.clone() {
        return message;
    }

    if item.code == 404 {
        if item
            .free_trial_privilege
            .as_ref()
            .is_some_and(|trial| trial.cannot_listen_reason == Some(1))
        {
            return "歌曲因版权或会员限制暂不可播放".to_string();
        }

        return "这首歌当前不可播放".to_string();
    }

    "网易云暂时没有返回可用音源".to_string()
}

#[tauri::command]
fn open_todo_popout(app: AppHandle, widget_id: String, title: String) {
    let label = format!("todo-popout-{}", widget_id);

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let url = format!("popout.html?widgetId={}&title={}", widget_id, title);

    let _win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(300.0, 440.0)
        .min_inner_size(240.0, 300.0)
        .always_on_top(true)
        .decorations(true)
        .resizable(true)
        .build()
        .unwrap();
}

#[tauri::command]
fn close_todo_popout(app: AppHandle, widget_id: String) {
    let label = format!("todo-popout-{}", widget_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
}

#[tauri::command]
async fn netease_restore_session(state: State<'_, AppState>) -> Result<NetEaseSessionSnapshot, String> {
    state.netease.restore_session().await
}

#[tauri::command]
async fn netease_start_qr_login(state: State<'_, AppState>) -> Result<NetEaseQrLoginStart, String> {
    state.netease.start_qr_login().await
}

#[tauri::command]
async fn netease_poll_qr_login(
    state: State<'_, AppState>,
    key: String,
) -> Result<NetEaseQrLoginPoll, String> {
    state.netease.poll_qr_login(&key).await
}

#[tauri::command]
async fn netease_fetch_liked_tracks(
    state: State<'_, AppState>,
) -> Result<NetEaseLikedTracksPayload, String> {
    state.netease.fetch_liked_tracks().await
}

#[tauri::command]
async fn netease_get_song_source(
    state: State<'_, AppState>,
    song_id: u64,
) -> Result<NetEaseSongSource, String> {
    state.netease.fetch_song_source(song_id).await
}

#[tauri::command]
fn netease_logout(state: State<'_, AppState>) -> Result<(), String> {
    state.netease.logout()
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("获取应用数据目录失败: {err}"))?;
            let cookie_path = app_data_dir.join(NETEASE_COOKIE_FILE);
            let netease = NetEaseClient::new(cookie_path)?;

            app.manage(AppState { netease });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_todo_popout,
            close_todo_popout,
            netease_restore_session,
            netease_start_qr_login,
            netease_poll_qr_login,
            netease_fetch_liked_tracks,
            netease_get_song_source,
            netease_logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetEaseSessionSnapshot {
    status: String,
    profile: Option<NetEaseProfile>,
    liked_playlist: Option<NetEasePlaylistSummary>,
    message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetEaseProfile {
    user_id: u64,
    nickname: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetEasePlaylistSummary {
    id: u64,
    name: String,
    cover_img_url: Option<String>,
    track_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetEaseLikedTracksPayload {
    playlist: NetEasePlaylistSummary,
    tracks: Vec<NetEaseTrack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetEaseTrack {
    id: u64,
    name: String,
    artists: Vec<String>,
    artist_line: String,
    album_name: String,
    cover_url: Option<String>,
    duration_ms: u64,
    playable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetEaseQrLoginStart {
    key: String,
    login_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetEaseQrLoginPoll {
    status: String,
    snapshot: Option<NetEaseSessionSnapshot>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetEaseSongSource {
    song_id: u64,
    url: Option<String>,
    expires_at: Option<u64>,
    level: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QrUnikeyResponse {
    code: i32,
    unikey: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QrPollResponse {
    code: i32,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AccountResponse {
    code: i32,
    profile: Option<AccountProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountProfile {
    user_id: u64,
    nickname: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserPlaylistResponse {
    code: i32,
    #[serde(default)]
    playlist: Vec<UserPlaylistItem>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserPlaylistItem {
    id: u64,
    name: String,
    cover_img_url: Option<String>,
    track_count: usize,
    special_type: i32,
    user_id: u64,
}

#[derive(Debug, Deserialize)]
struct PlaylistDetailResponse {
    code: i32,
    playlist: PlaylistDetail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistDetail {
    #[serde(default)]
    track_ids: Vec<PlaylistTrackId>,
}

#[derive(Debug, Deserialize)]
struct PlaylistTrackId {
    id: u64,
}

#[derive(Debug, Deserialize)]
struct SongDetailResponse {
    code: i32,
    #[serde(default)]
    songs: Vec<SongDetailSong>,
    #[serde(default)]
    privileges: Vec<SongPrivilege>,
}

#[derive(Debug, Deserialize)]
struct SongDetailSong {
    id: u64,
    name: String,
    #[serde(rename = "ar", default)]
    artists: Vec<SongArtist>,
    #[serde(rename = "al")]
    album: SongAlbum,
    #[serde(rename = "dt")]
    duration_ms: u64,
}

#[derive(Debug, Deserialize)]
struct SongArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct SongAlbum {
    name: String,
    #[serde(rename = "picUrl")]
    pic_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SongPrivilege {
    id: u64,
    pl: i64,
    st: i32,
    #[serde(default)]
    free_trial_privilege: Option<FreeTrialPrivilege>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FreeTrialPrivilege {
    res_consumable: bool,
    user_consumable: bool,
    cannot_listen_reason: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct SongUrlResponse {
    code: i32,
    #[serde(default)]
    data: Vec<SongUrlItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SongUrlItem {
    url: Option<String>,
    expi: Option<i64>,
    code: i32,
    level: Option<String>,
    message: Option<String>,
    #[serde(default)]
    free_trial_privilege: Option<FreeTrialPrivilege>,
}
