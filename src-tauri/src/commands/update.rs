use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::error::{AppError, AppResult};

const UPDATE_CHECK_TIMEOUT_SECS: u64 = 20;
const UPDATE_DOWNLOAD_TIMEOUT_SECS: u64 = 300;
const UPDATE_ENDPOINTS: &[&str] =
    &["https://github.com/dxx/apisender/releases/latest/download/latest.json"];

#[derive(Default)]
pub struct UpdateState {
    inner: Mutex<UpdateStateInner>,
}

enum UpdateStateInner {
    Idle,
    Available(Update),
    Downloading(DownloadingUpdate),
    Downloaded(DownloadedUpdate),
    Installing(UpdateMetadata),
}

impl Default for UpdateStateInner {
    fn default() -> Self {
        Self::Idle
    }
}

struct DownloadingUpdate {
    metadata: UpdateMetadata,
    cancel: CancellationToken,
    downloaded: u64,
    total: Option<u64>,
}

struct DownloadedUpdate {
    update: Update,
    metadata: UpdateMetadata,
    bytes: Vec<u8>,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub target: String,
    pub download_url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: String,
    pub metadata: Option<UpdateMetadata>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub progress_percent: Option<u8>,
    pub can_cancel: bool,
    pub can_install: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
        downloaded: u64,
        content_length: Option<u64>,
        progress_percent: Option<u8>,
    },
    Finished,
    Cancelled,
}

impl From<&Update> for UpdateMetadata {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|date| date.to_string()),
            target: update.target.clone(),
            download_url: update.download_url.to_string(),
        }
    }
}

/// 入参：原始错误字符串。
/// 出参：适合前端直接展示的中文错误提示。
/// 作用与流程：根据更新器返回的错误关键词判断失败类型，再补充用户下一步可执行的处理建议。
pub fn describe_update_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("cancel") || lower.contains("canceled") || lower.contains("cancelled") {
        return "已取消下载。你可以稍后重新下载这个更新。".to_string();
    }
    if lower.contains("timeout") || lower.contains("timed out") {
        return format!("网络连接超时。请检查网络或稍后重试。原始错误：{raw}");
    }
    if lower.contains("signature")
        || lower.contains("verify")
        || lower.contains("verification")
        || lower.contains("minisign")
    {
        return format!(
            "签名验证失败，更新包可能不完整或签名密钥不匹配。不要安装这个包，请重新发布或重新下载。原始错误：{raw}"
        );
    }
    if lower.contains("404") || lower.contains("not found") {
        return format!(
            "没有找到更新清单或安装包。请确认 GitHub Release 已上传 latest.json 和对应平台包。原始错误：{raw}"
        );
    }
    if lower.contains("403") || lower.contains("401") || lower.contains("rate limit") {
        return format!(
            "更新源拒绝访问或触发限流。请检查 Release 权限、下载地址或稍后重试。原始错误：{raw}"
        );
    }
    if lower.contains("public key") || lower.contains("pubkey") {
        return format!(
            "自动更新公钥未配置或格式不正确。请设置 APISENDER_UPDATER_PUBLIC_KEY 并重新构建应用。原始错误：{raw}"
        );
    }
    if lower.contains("dns") || lower.contains("resolve") || lower.contains("connection") {
        return format!(
            "连接更新服务器失败。请检查网络、代理或 GitHub Release 是否可访问。原始错误：{raw}"
        );
    }
    format!("更新失败。请稍后重试，或从 GitHub Release 手动下载安装包。原始错误：{raw}")
}

/// 入参：已下载字节数和总字节数。
/// 出参：下载中的更新状态快照。
/// 作用与流程：把字节进度转换为前端状态字段，并声明此阶段允许取消但不能安装。
pub fn downloading_status(downloaded: u64, total: Option<u64>) -> UpdateStatus {
    UpdateStatus {
        phase: "downloading".to_string(),
        metadata: None,
        downloaded,
        total,
        progress_percent: progress_percent(downloaded, total),
        can_cancel: true,
        can_install: false,
        message: Some("正在下载更新包".to_string()),
    }
}

/// 入参：已下载字节数和总字节数。
/// 出参：已下载待安装的更新状态快照。
/// 作用与流程：把完成后的字节信息转换为前端状态字段，并声明此阶段允许延迟安装。
pub fn downloaded_status(downloaded: u64, total: Option<u64>) -> UpdateStatus {
    UpdateStatus {
        phase: "downloaded".to_string(),
        metadata: None,
        downloaded,
        total,
        progress_percent: progress_percent(downloaded, total),
        can_cancel: false,
        can_install: true,
        message: Some("更新已下载，可稍后安装".to_string()),
    }
}

/// 入参：Tauri 应用句柄。
/// 出参：当前是否有可用更新，以及更新状态快照。
/// 作用与流程：读取编译期公钥和 GitHub Release 更新源，检查远端 latest.json，并把可安装更新暂存到内存状态。
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> AppResult<UpdateStatus> {
    if let Some(status) = retained_status(&state) {
        return Ok(status);
    }

    let updater = build_updater(&app, Duration::from_secs(UPDATE_CHECK_TIMEOUT_SECS))?;
    let update = updater.check().await.map_err(update_error)?;

    let status = match update {
        Some(update) => {
            let metadata = UpdateMetadata::from(&update);
            let status = available_status(metadata.clone());
            let mut guard = state.inner.lock().unwrap();
            *guard = UpdateStateInner::Available(update);
            status
        }
        None => {
            let mut guard = state.inner.lock().unwrap();
            *guard = UpdateStateInner::Idle;
            up_to_date_status()
        }
    };

    Ok(status)
}

/// 入参：更新状态和前端下载事件通道。
/// 出参：下载完成后的状态快照，或取消后恢复为可下载状态。
/// 作用与流程：取出待下载更新，启动官方 updater 下载与签名验证；下载过程中持续发送进度，取消时丢弃下载 future 并保留待下载更新。
#[tauri::command]
pub async fn download_update(
    state: State<'_, UpdateState>,
    on_event: Channel<UpdateDownloadEvent>,
) -> AppResult<UpdateStatus> {
    let (mut update, metadata, cancel) = take_available_update(&state)?;
    update.timeout = Some(Duration::from_secs(UPDATE_DOWNLOAD_TIMEOUT_SECS));
    let _ = on_event.send(UpdateDownloadEvent::Started {
        content_length: None,
    });

    let mut downloaded = 0_u64;
    let mut total = None;
    let progress_channel = on_event.clone();
    let finish_channel = on_event.clone();

    let download_result = {
        let download = update.download(
            |chunk_length, content_length| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                total = content_length;
                update_download_progress(&state, downloaded, total);
                let _ = progress_channel.send(UpdateDownloadEvent::Progress {
                    chunk_length,
                    downloaded,
                    content_length,
                    progress_percent: progress_percent(downloaded, content_length),
                });
            },
            || {
                let _ = finish_channel.send(UpdateDownloadEvent::Finished);
            },
        );

        tokio::select! {
            result = download => Some(result),
            _ = cancel.cancelled() => None,
        }
    };

    match download_result {
        Some(Ok(bytes)) => {
            let status = status_with_metadata(downloaded_status(downloaded, total), &metadata);
            let mut guard = state.inner.lock().unwrap();
            *guard = UpdateStateInner::Downloaded(DownloadedUpdate {
                update,
                metadata,
                bytes,
                downloaded,
                total,
            });
            Ok(status)
        }
        Some(Err(error)) => {
            restore_available_update(&state, update);
            Err(update_error(error))
        }
        None => {
            let _ = on_event.send(UpdateDownloadEvent::Cancelled);
            let status = available_status(metadata);
            restore_available_update(&state, update);
            Ok(status)
        }
    }
}

/// 入参：更新状态。
/// 出参：是否找到了正在进行的下载任务。
/// 作用与流程：定位下载中的取消令牌并触发取消；如果没有下载任务则返回 false，方便前端做幂等处理。
#[tauri::command]
pub async fn cancel_update_download(state: State<'_, UpdateState>) -> AppResult<bool> {
    let cancel = {
        let guard = state.inner.lock().unwrap();
        match &*guard {
            UpdateStateInner::Downloading(entry) => Some(entry.cancel.clone()),
            _ => None,
        }
    };

    if let Some(cancel) = cancel {
        cancel.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 入参：更新状态。
/// 出参：当前更新状态快照。
/// 作用与流程：把后端内存中的待下载、下载中、已下载或安装中状态转换为前端可渲染的数据。
#[tauri::command]
pub async fn get_update_status(state: State<'_, UpdateState>) -> AppResult<UpdateStatus> {
    Ok(current_status(&state))
}

/// 入参：更新状态。
/// 出参：安装执行结果。
/// 作用与流程：取出已下载且已签名验证的更新包，调用 Tauri 官方安装逻辑；安装成功后清空状态，由前端决定是否重启。
#[tauri::command]
pub async fn install_downloaded_update(state: State<'_, UpdateState>) -> AppResult<()> {
    let downloaded = take_downloaded_update(&state)?;
    let metadata = downloaded.metadata.clone();

    {
        let mut guard = state.inner.lock().unwrap();
        *guard = UpdateStateInner::Installing(metadata.clone());
    }

    if let Err(error) = downloaded.update.install(&downloaded.bytes) {
        let mut guard = state.inner.lock().unwrap();
        *guard = UpdateStateInner::Downloaded(downloaded);
        return Err(update_error(error));
    }

    let mut guard = state.inner.lock().unwrap();
    *guard = UpdateStateInner::Idle;
    Ok(())
}

/// 入参：Tauri 应用句柄和请求超时时间。
/// 出参：配置好 GitHub Release endpoint 与超时时间的 updater。
/// 作用与流程：默认使用 tauri.conf.json 中的 updater 公钥；如果构建时提供 APISENDER_UPDATER_PUBLIC_KEY，则用该值覆盖配置。
fn build_updater(app: &AppHandle, timeout: Duration) -> AppResult<tauri_plugin_updater::Updater> {
    let endpoints = UPDATE_ENDPOINTS
        .iter()
        .map(|endpoint| Url::parse(endpoint))
        .collect::<Result<Vec<_>, _>>()?;

    let builder = app
        .updater_builder()
        .endpoints(endpoints)
        .map_err(update_error)?
        .timeout(timeout);
    let builder = if let Some(pubkey) = embedded_updater_public_key() {
        builder.pubkey(pubkey)
    } else {
        builder
    };

    builder.build().map_err(update_error)
}

/// 入参：无。
/// 出参：编译期嵌入的 updater 公钥；未配置时返回 None。
/// 作用与流程：读取 APISENDER_UPDATER_PUBLIC_KEY 并过滤空字符串，避免把占位配置打进正式应用。
pub fn embedded_updater_public_key() -> Option<&'static str> {
    option_env!("APISENDER_UPDATER_PUBLIC_KEY").and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// 入参：已下载字节数和总字节数。
/// 出参：0 到 100 的百分比；总字节数未知或为 0 时返回 None。
/// 作用与流程：用饱和计算避免溢出，并把超过总大小的异常进度限制到 100。
fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    total.and_then(|total| {
        if total == 0 {
            None
        } else {
            Some(
                downloaded
                    .saturating_mul(100)
                    .saturating_div(total)
                    .min(100) as u8,
            )
        }
    })
}

/// 入参：更新状态。
/// 出参：当前状态快照；没有任何更新上下文时返回 idle。
/// 作用与流程：读取状态机并根据不同阶段生成前端需要的按钮能力、进度和提示。
fn current_status(state: &UpdateState) -> UpdateStatus {
    let guard = state.inner.lock().unwrap();
    match &*guard {
        UpdateStateInner::Idle => idle_status(),
        UpdateStateInner::Available(update) => available_status(UpdateMetadata::from(update)),
        UpdateStateInner::Downloading(entry) => {
            let status = downloading_status(entry.downloaded, entry.total);
            status_with_metadata(status, &entry.metadata)
        }
        UpdateStateInner::Downloaded(entry) => {
            let status = downloaded_status(entry.downloaded, entry.total);
            status_with_metadata(status, &entry.metadata)
        }
        UpdateStateInner::Installing(metadata) => installing_status(metadata.clone()),
    }
}

/// 入参：更新状态。
/// 出参：下载中、已下载或安装中这些需要保留的状态快照；其它阶段返回 None。
/// 作用与流程：避免用户重复检查更新时覆盖已经下载好的安装包。
fn retained_status(state: &UpdateState) -> Option<UpdateStatus> {
    let guard = state.inner.lock().unwrap();
    match &*guard {
        UpdateStateInner::Downloading(entry) => {
            let status = downloading_status(entry.downloaded, entry.total);
            Some(status_with_metadata(status, &entry.metadata))
        }
        UpdateStateInner::Downloaded(entry) => {
            let status = downloaded_status(entry.downloaded, entry.total);
            Some(status_with_metadata(status, &entry.metadata))
        }
        UpdateStateInner::Installing(metadata) => Some(installing_status(metadata.clone())),
        _ => None,
    }
}

/// 入参：更新状态。
/// 出参：待下载的更新、元数据和取消令牌。
/// 作用与流程：从状态机中原子地取出可用更新，并切换到 downloading 阶段供取消命令定位。
fn take_available_update(
    state: &UpdateState,
) -> AppResult<(Update, UpdateMetadata, CancellationToken)> {
    let mut guard = state.inner.lock().unwrap();
    match std::mem::replace(&mut *guard, UpdateStateInner::Idle) {
        UpdateStateInner::Available(update) => {
            let metadata = UpdateMetadata::from(&update);
            let cancel = CancellationToken::new();
            *guard = UpdateStateInner::Downloading(DownloadingUpdate {
                metadata: metadata.clone(),
                cancel: cancel.clone(),
                downloaded: 0,
                total: None,
            });
            Ok((update, metadata, cancel))
        }
        UpdateStateInner::Downloaded(entry) => {
            let status = downloaded_status(entry.downloaded, entry.total);
            *guard = UpdateStateInner::Downloaded(entry);
            Err(AppError::Other(
                status
                    .message
                    .unwrap_or_else(|| "更新包已经下载完成".to_string()),
            ))
        }
        UpdateStateInner::Downloading(entry) => {
            *guard = UpdateStateInner::Downloading(entry);
            Err(AppError::Other("更新正在下载中".to_string()))
        }
        UpdateStateInner::Installing(metadata) => {
            *guard = UpdateStateInner::Installing(metadata);
            Err(AppError::Other("更新正在安装中".to_string()))
        }
        UpdateStateInner::Idle => {
            *guard = UpdateStateInner::Idle;
            Err(AppError::Other(
                "没有可下载的更新，请先检查更新。".to_string(),
            ))
        }
    }
}

/// 入参：更新状态、进度字节数和总字节数。
/// 出参：无。
/// 作用与流程：下载回调触发时更新内存状态，供设置页或状态查询命令读取实时进度。
fn update_download_progress(state: &UpdateState, downloaded: u64, total: Option<u64>) {
    let mut guard = state.inner.lock().unwrap();
    if let UpdateStateInner::Downloading(entry) = &mut *guard {
        entry.downloaded = downloaded;
        entry.total = total;
    }
}

/// 入参：更新状态和更新对象。
/// 出参：无。
/// 作用与流程：下载失败或取消后把更新对象放回 available 状态，允许用户重新下载。
fn restore_available_update(state: &UpdateState, update: Update) {
    let mut guard = state.inner.lock().unwrap();
    *guard = UpdateStateInner::Available(update);
}

/// 入参：更新状态。
/// 出参：已下载更新对象、元数据和包字节。
/// 作用与流程：安装前从状态机取出已验证的更新包，避免并发安装同一个包。
fn take_downloaded_update(state: &UpdateState) -> AppResult<DownloadedUpdate> {
    let mut guard = state.inner.lock().unwrap();
    match std::mem::replace(&mut *guard, UpdateStateInner::Idle) {
        UpdateStateInner::Downloaded(entry) => Ok(entry),
        other => {
            *guard = other;
            Err(AppError::Other(
                "没有已下载的更新包，请先下载更新。".to_string(),
            ))
        }
    }
}

/// 入参：任意 updater 错误。
/// 出参：应用统一错误类型。
/// 作用与流程：把底层错误转成增强后的中文说明，保证前端 toast 和对话框看到同一套提示。
fn update_error(error: impl ToString) -> AppError {
    AppError::Other(describe_update_error(&error.to_string()))
}

/// 入参：更新元数据。
/// 出参：可下载状态快照。
/// 作用与流程：把检查到的更新转换成前端可渲染状态，并开启下载按钮。
fn available_status(metadata: UpdateMetadata) -> UpdateStatus {
    UpdateStatus {
        phase: "available".to_string(),
        metadata: Some(metadata),
        downloaded: 0,
        total: None,
        progress_percent: None,
        can_cancel: false,
        can_install: false,
        message: Some("发现新版本，可以下载更新。".to_string()),
    }
}

/// 入参：无。
/// 出参：空闲状态快照。
/// 作用与流程：用于应用启动或清空更新状态后，让前端展示检查更新入口。
fn idle_status() -> UpdateStatus {
    UpdateStatus {
        phase: "idle".to_string(),
        metadata: None,
        downloaded: 0,
        total: None,
        progress_percent: None,
        can_cancel: false,
        can_install: false,
        message: None,
    }
}

/// 入参：无。
/// 出参：已是最新版本状态快照。
/// 作用与流程：检查更新返回空结果时生成稳定的用户提示。
fn up_to_date_status() -> UpdateStatus {
    UpdateStatus {
        phase: "upToDate".to_string(),
        metadata: None,
        downloaded: 0,
        total: None,
        progress_percent: None,
        can_cancel: false,
        can_install: false,
        message: Some("当前已经是最新版本。".to_string()),
    }
}

/// 入参：更新元数据。
/// 出参：安装中状态快照。
/// 作用与流程：安装命令开始后冻结状态，避免前端继续触发下载或安装。
fn installing_status(metadata: UpdateMetadata) -> UpdateStatus {
    UpdateStatus {
        phase: "installing".to_string(),
        metadata: Some(metadata),
        downloaded: 0,
        total: None,
        progress_percent: None,
        can_cancel: false,
        can_install: false,
        message: Some("正在安装更新。".to_string()),
    }
}

/// 入参：基础状态和更新元数据。
/// 出参：带元数据的状态快照。
/// 作用与流程：复用下载状态 helper 的按钮与进度字段，再补充版本、说明和下载地址。
fn status_with_metadata(mut status: UpdateStatus, metadata: &UpdateMetadata) -> UpdateStatus {
    status.metadata = Some(metadata.clone());
    status
}

#[cfg(test)]
mod tests {
    use super::{describe_update_error, downloaded_status, downloading_status};

    #[test]
    fn download_status_reports_cancel_and_percentage_while_downloading() {
        let status = downloading_status(25, Some(100));

        assert_eq!(status.phase, "downloading");
        assert_eq!(status.progress_percent, Some(25));
        assert!(status.can_cancel);
        assert!(!status.can_install);
    }

    #[test]
    fn downloaded_status_reports_install_is_available() {
        let status = downloaded_status(100, Some(100));

        assert_eq!(status.phase, "downloaded");
        assert_eq!(status.progress_percent, Some(100));
        assert!(!status.can_cancel);
        assert!(status.can_install);
    }

    #[test]
    fn update_errors_are_rewritten_for_common_user_actions() {
        assert!(describe_update_error("operation timed out").contains("网络连接超时"));
        assert!(describe_update_error("signature verification failed").contains("签名验证失败"));
        assert!(describe_update_error("download cancelled by user").contains("已取消下载"));
    }
}
