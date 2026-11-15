use apisender_lib::commands::update::{describe_update_error, downloaded_status, downloading_status};

/// 入参：下载进度字节数和总量。
/// 出参：downloading 阶段的状态。
/// 作用与流程：验证 downloading 状态能暴露取消按钮、已下载百分比，但不允许安装。
#[test]
fn download_status_reports_cancel_and_percentage_while_downloading() {
    let status = downloading_status(25, Some(100));

    assert_eq!(status.phase, "downloading");
    assert_eq!(status.progress_percent, Some(25));
    assert!(status.can_cancel);
    assert!(!status.can_install);
}

/// 入参：下载完成的字节数和总量。
/// 出参：downloaded 阶段的状态。
/// 作用与流程：验证 downloaded 状态不再允许取消，并已就绪可安装。
#[test]
fn downloaded_status_reports_install_is_available() {
    let status = downloaded_status(100, Some(100));

    assert_eq!(status.phase, "downloaded");
    assert_eq!(status.progress_percent, Some(100));
    assert!(!status.can_cancel);
    assert!(status.can_install);
}

/// 入参：更新器抛出的原始错误字符串。
/// 出参：面向用户的本地化错误提示。
/// 作用与流程：覆盖网络超时、签名失败、用户取消三条主要分支，确保文案被改写为中文。
#[test]
fn update_errors_are_rewritten_for_common_user_actions() {
    assert!(describe_update_error("operation timed out").contains("网络连接超时"));
    assert!(describe_update_error("signature verification failed").contains("签名验证失败"));
    assert!(describe_update_error("download cancelled by user").contains("已取消下载"));
}