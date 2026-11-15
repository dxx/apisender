use std::fs;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

use apisender_lib::git::{
    GitErrorCode, GitOperationState, clone_repository, connect_origin, create_branch, diff,
    init_workspace, list_branches, list_commits, null_device_path, parse_porcelain_v2, pull, push,
    redact_secrets, set_identity, show_commit, stage, status, switch_branch, unstage,
};
use apisender_lib::workspace::watcher::is_git_internal_path;

static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct TestDir(PathBuf);

impl Deref for TestDir {
    type Target = Path;

    /// 返回临时目录路径引用。
    /// 入参：当前 TestDir 引用。
    /// 出参：内部 Path 引用。
    /// 作用与流程：让测试目录可直接调用 Path 方法并传给 Git 服务函数。
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AsRef<Path> for TestDir {
    /// 将测试目录转换为 Path 引用。
    /// 入参：当前 TestDir 引用。
    /// 出参：内部 Path 引用。
    /// 作用与流程：支持 std::fs 等接受 AsRef<Path> 的清理和读写接口。
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    /// 自动清理测试临时目录。
    /// 入参：当前 TestDir 可变引用。
    /// 出参：无。
    /// 作用与流程：无论测试正常结束还是 panic 展开，都尝试递归删除本次目录。
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 创建临时测试目录。
/// 入参：测试名称。
/// 出参：当前测试独占的临时目录路径。
/// 作用与流程：组合进程号和递增序号生成目录，先清理同名残留再创建目录。
fn temp_dir(name: &str) -> TestDir {
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "apisender-git-{name}-{}-{sequence}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    TestDir(path)
}

/// 在指定目录执行 Git 测试命令。
/// 入参：命令工作目录和参数列表。
/// 出参：标准输出文本。
/// 作用与流程：调用系统 Git，断言退出成功并返回 UTF-8 输出。
fn run_git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
/// 校验 porcelain v2 状态解析。
/// 入参/出参：无；断言分支、ahead/behind、重命名、未跟踪与冲突字段。
/// 作用与流程：构造含空格和 NUL 分隔路径的原始输出并验证结构化结果。
fn parses_porcelain_v2_status_with_branch_and_rename() {
    let raw = concat!(
        "# branch.oid abcdef\0",
        "# branch.head feature/test\0",
        "# branch.upstream origin/feature/test\0",
        "# branch.ab +2 -3\0",
        "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged file.http\0",
        "1 .M N... 100644 100644 100644 aaaaaaa aaaaaaa worktree.json\0",
        "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 renamed.http\0old name.http\0",
        "? new file.proto\0",
        "u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.http\0"
    );

    let state = parse_porcelain_v2("/workspace/subdir", "/workspace", raw.as_bytes()).unwrap();

    assert_eq!(state.branch.as_deref(), Some("feature/test"));
    assert_eq!(state.upstream.as_deref(), Some("origin/feature/test"));
    assert_eq!((state.ahead, state.behind), (2, 3));
    assert_eq!(state.files.len(), 5);
    assert!(state.remotes.is_empty());
    assert_eq!(state.files[2].path, "renamed.http");
    assert_eq!(
        state.files[2].original_path.as_deref(),
        Some("old name.http")
    );
    assert!(state.files[3].untracked);
    assert!(state.files[4].conflict);
}

#[test]
/// 校验 HTTPS 远端凭据脱敏。
/// 入参/出参：无；断言用户名与令牌不会出现在结果中。
/// 作用与流程：传入带 userinfo 的失败文本并比较脱敏输出。
fn redacts_credentials_from_https_urls() {
    let input = "fatal: https://alice:secret-token@example.com/org/repo.git denied";
    assert_eq!(
        redact_secrets(input),
        "fatal: https://***@example.com/org/repo.git denied"
    );
    assert_eq!(
        redact_secrets(
            "fatal: https://example.com/org/repo.git?access_token=secret-token&ref=main denied"
        ),
        "fatal: https://example.com/org/repo.git?access_token=***&ref=main denied"
    );
}

#[test]
/// 校验本地仓库日常操作闭环。
/// 入参/出参：无；断言状态、暂存、diff、提交、日志和分支操作。
/// 作用与流程：在自动清理临时仓库中依次执行用户常用操作。
fn repository_status_stage_diff_commit_and_branches_work() {
    let root = temp_dir("lifecycle");
    run_git(&root, &["init", "-b", "main"]);
    set_identity(&root, "API Sender Test", "test@example.com").unwrap();
    fs::write(root.join("request.http"), "GET https://example.com\n").unwrap();

    let before = status(&root).unwrap();
    assert!(
        before
            .files
            .iter()
            .any(|file| file.path == "request.http" && file.untracked)
    );

    stage(&root, &["request.http".to_string()]).unwrap();
    let staged = status(&root).unwrap();
    assert_eq!(staged.files[0].index_status.as_deref(), Some("A"));
    assert!(
        !diff(&root, "request.http", true, None)
            .unwrap()
            .content
            .is_empty()
    );

    let first_commit = apisender_lib::git::commit(&root, "新增请求示例").unwrap();
    assert_eq!(list_commits(&root, 0, 50).unwrap().len(), 1);
    assert_eq!(
        show_commit(&root, &first_commit.sha).unwrap().files,
        vec!["request.http"]
    );

    create_branch(&root, "feature/git-sync").unwrap();
    assert_eq!(
        status(&root).unwrap().branch.as_deref(),
        Some("feature/git-sync")
    );
    switch_branch(&root, "main").unwrap();
    assert_eq!(status(&root).unwrap().branch.as_deref(), Some("main"));
    assert!(
        list_branches(&root)
            .unwrap()
            .iter()
            .any(|branch| branch.name == "feature/git-sync")
    );

    fs::write(root.join("request.http"), "GET https://example.org\n").unwrap();
    stage(&root, &["request.http".to_string()]).unwrap();
    unstage(&root, &["request.http".to_string()]).unwrap();
    assert_eq!(status(&root).unwrap().files[0].index_status, None);

    fs::remove_dir_all(root).unwrap();
}

#[test]
/// 校验初始化会拒绝非空远端。
/// 入参/出参：无；断言返回 remote_not_empty。
/// 作用与流程：创建仅含自定义 ref 的 bare 远端，再尝试把普通工作区连接为新仓库。
fn init_rejects_non_empty_remote() {
    let remote_parent = temp_dir("remote-non-empty");
    let remote = remote_parent.join("origin.git");
    run_git(
        &remote_parent,
        &["init", "--bare", remote.to_string_lossy().as_ref()],
    );
    let source = temp_dir("remote-non-empty-source");
    run_git(&source, &["init", "-b", "main"]);
    run_git(&source, &["config", "user.name", "Test"]);
    run_git(&source, &["config", "user.email", "test@example.com"]);
    fs::write(source.join("README.md"), "existing").unwrap();
    run_git(&source, &["add", "README.md"]);
    run_git(&source, &["commit", "-m", "initial"]);
    run_git(
        &source,
        &[
            "push",
            remote.to_string_lossy().as_ref(),
            "HEAD:refs/custom/existing",
        ],
    );

    let workspace = temp_dir("init-workspace");
    let error = init_workspace(&workspace, remote.to_string_lossy().as_ref(), "main").unwrap_err();
    assert_eq!(error.code, GitErrorCode::RemoteNotEmpty);
}

#[test]
/// 校验初始化不会覆盖无法安全读取的现有 .gitignore。
/// 入参/出参：无；断言返回 io 错误且原始字节保持不变。
/// 作用与流程：准备空 bare 远端和非 UTF-8 忽略文件，验证追加规则在读取失败时停止。
fn init_preserves_unreadable_gitignore_bytes() {
    let remote_parent = temp_dir("invalid-ignore-remote");
    let remote = remote_parent.join("origin.git");
    run_git(
        &remote_parent,
        &["init", "--bare", remote.to_string_lossy().as_ref()],
    );
    let workspace = temp_dir("invalid-ignore-workspace");
    fs::write(workspace.join(".gitignore"), [0xff, 0xfe]).unwrap();

    let error = init_workspace(&workspace, remote.to_string_lossy().as_ref(), "main").unwrap_err();
    assert_eq!(error.code, GitErrorCode::Io);
    assert_eq!(
        fs::read(workspace.join(".gitignore")).unwrap(),
        [0xff, 0xfe]
    );
}

#[test]
/// 校验 Git 写操作互斥状态。
/// 入参/出参：无；断言第二个并发 guard 被拒绝且释放后可重试。
/// 作用与流程：连续申请两次写锁，再释放首个 guard 验证状态恢复。
fn write_operation_state_rejects_concurrent_writes() {
    let state = GitOperationState::default();
    let first = state.try_begin().unwrap();
    let error = state.try_begin().unwrap_err();
    assert_eq!(error.code, GitErrorCode::OperationBusy);
    drop(first);
    assert!(state.try_begin().is_ok());
}

#[test]
/// 校验本地 bare remote 的完整同步行为。
/// 入参/出参：无；断言首次 push、clone、快进 pull 和分叉拒绝。
/// 作用与流程：用源仓库、bare remote 和克隆仓库模拟双端开发且不访问网络。
fn local_bare_remote_supports_push_clone_fast_forward_pull_and_rejects_divergence() {
    let remote_parent = temp_dir("remote-flow");
    let remote = remote_parent.join("origin.git");
    run_git(
        &remote_parent,
        &["init", "--bare", remote.to_string_lossy().as_ref()],
    );

    let source = temp_dir("remote-source");
    init_workspace(&source, remote.to_string_lossy().as_ref(), "main").unwrap();
    set_identity(&source, "Source User", "source@example.com").unwrap();
    fs::write(source.join("request.http"), "GET https://v1.example.com\n").unwrap();
    stage(&source, &["request.http".to_string()]).unwrap();
    apisender_lib::git::commit(&source, "初始化远端").unwrap();
    push(&source, Some("origin"), Some("main")).unwrap();
    assert_eq!(status(&source).unwrap().remotes, vec!["origin"]);

    let clones = temp_dir("remote-clones");
    let clone =
        clone_repository(&clones, "working-copy", remote.to_string_lossy().as_ref()).unwrap();
    set_identity(&clone, "Clone User", "clone@example.com").unwrap();
    assert_eq!(
        status(&clone).unwrap().upstream.as_deref(),
        Some("origin/main")
    );

    fs::write(source.join("request.http"), "GET https://v2.example.com\n").unwrap();
    stage(&source, &["request.http".to_string()]).unwrap();
    apisender_lib::git::commit(&source, "更新远端请求").unwrap();
    push(&source, None, None).unwrap();
    pull(&clone).unwrap();
    assert_eq!(
        fs::read_to_string(clone.join("request.http")).unwrap(),
        "GET https://v2.example.com\n"
    );

    fs::write(clone.join("clone.http"), "GET https://clone.example.com\n").unwrap();
    stage(&clone, &["clone.http".to_string()]).unwrap();
    apisender_lib::git::commit(&clone, "本地分叉").unwrap();
    fs::write(
        source.join("source.http"),
        "GET https://source.example.com\n",
    )
    .unwrap();
    stage(&source, &["source.http".to_string()]).unwrap();
    apisender_lib::git::commit(&source, "远端分叉").unwrap();
    push(&source, None, None).unwrap();

    let error = pull(&clone).unwrap_err();
    assert_eq!(error.code, GitErrorCode::NonFastForward);

    fs::remove_dir_all(remote_parent).unwrap();
    fs::remove_dir_all(source).unwrap();
    fs::remove_dir_all(clones).unwrap();
}

#[test]
/// 校验跨平台空设备名称。
/// 入参/出参：无；按编译目标断言 Windows 与类 Unix 路径。
/// 作用与流程：防止未跟踪文件 no-index diff 硬编码类 Unix 路径。
fn null_device_matches_the_current_platform() {
    #[cfg(target_os = "windows")]
    assert_eq!(null_device_path(), "NUL");

    #[cfg(not(target_os = "windows"))]
    assert_eq!(null_device_path(), "/dev/null");
}

#[test]
/// 校验 watcher 的 Git 内部路径分类。
/// 入参/出参：无；断言 `.git` 内部与工作区 `.gitignore` 被正确区分。
/// 作用与流程：构造典型路径并验证层级判断。
fn watcher_distinguishes_git_internal_files_from_worktree_files() {
    let repository = Path::new("/repo");
    let git_dir = repository.join(".git");

    assert!(is_git_internal_path(&git_dir.join("index"), &git_dir));
    assert!(is_git_internal_path(
        &git_dir.join("refs/heads/main"),
        &git_dir
    ));
    assert!(!is_git_internal_path(
        &repository.join("request.http"),
        &git_dir
    ));
    assert!(!is_git_internal_path(
        &repository.join(".gitignore"),
        &git_dir
    ));
}

#[test]
/// 校验克隆不会覆盖非空目录。
/// 入参/出参：无；断言 target_not_empty 且原文件仍存在。
/// 作用与流程：预建包含文件的目标目录，再调用克隆入口验证早期拒绝。
fn clone_rejects_non_empty_target_directory() {
    let parent = temp_dir("clone-target");
    let target = parent.join("existing");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("keep.txt"), "do not delete").unwrap();

    let error = clone_repository(&parent, "existing", "/tmp/missing.git").unwrap_err();
    assert_eq!(error.code, GitErrorCode::TargetNotEmpty);
    assert!(target.join("keep.txt").exists());

    let file_target = parent.join("file-target");
    fs::write(&file_target, "keep file").unwrap();
    let file_error = clone_repository(&parent, "file-target", "/tmp/missing.git").unwrap_err();
    assert_eq!(file_error.code, GitErrorCode::TargetNotEmpty);
    assert_eq!(fs::read_to_string(file_target).unwrap(), "keep file");

    fs::remove_dir_all(parent).unwrap();
}

#[test]
/// 校验克隆失败时只清理本次新建的目录。
/// 入参/出参：无；断言新目标被移除，而原本存在的空目录被保留。
/// 作用与流程：分别以不存在和预建空目录为目标克隆缺失远端，验证失败清理边界。
fn clone_failure_preserves_preexisting_empty_directory() {
    let parent = temp_dir("clone-failure-cleanup");
    let missing_remote = parent.join("missing.git");

    let new_error = clone_repository(
        &parent,
        "new-target",
        missing_remote.to_string_lossy().as_ref(),
    )
    .unwrap_err();
    assert_eq!(new_error.code, GitErrorCode::RemoteMissing);
    assert!(!parent.join("new-target").exists());

    let existing = parent.join("existing-empty");
    fs::create_dir(&existing).unwrap();
    let existing_error = clone_repository(
        &parent,
        "existing-empty",
        missing_remote.to_string_lossy().as_ref(),
    )
    .unwrap_err();
    assert_eq!(existing_error.code, GitErrorCode::RemoteMissing);
    assert!(existing_error.message.contains("原有空目录已保留"));
    assert!(existing.is_dir());
    assert_eq!(fs::read_dir(existing).unwrap().count(), 0);
}

#[test]
/// 校验缺少推送目标时返回稳定错误码。
/// 入参/出参：无；断言没有 upstream 返回 upstream_missing，未知远端返回 remote_missing。
/// 作用与流程：创建只有本地提交的仓库，验证默认推送错误分类及首次推送远端白名单。
fn push_without_remote_reports_upstream_missing() {
    let root = temp_dir("missing-upstream");
    run_git(&root, &["init", "-b", "main"]);
    set_identity(&root, "Test", "test@example.com").unwrap();
    fs::write(root.join("request.http"), "GET https://example.com\n").unwrap();
    stage(&root, &["request.http".to_string()]).unwrap();
    apisender_lib::git::commit(&root, "本地提交").unwrap();

    let error = push(&root, None, None).unwrap_err();
    assert_eq!(error.code, GitErrorCode::UpstreamMissing);

    let remote_error = push(&root, Some("--help"), Some("main")).unwrap_err();
    assert_eq!(remote_error.code, GitErrorCode::RemoteMissing);
}

#[test]
/// 校验已有仓库可以连接缺失的 origin，且不会覆盖已有 origin。
/// 入参/出参：无；断言首次连接成功、重复连接返回 remote_already_exists。
/// 作用与流程：创建本地仓库和 bare 远端，通过服务入口连接两次以覆盖正常与保护路径。
fn connect_origin_adds_missing_remote_and_refuses_overwrite() {
    let root = temp_dir("connect-origin");
    run_git(&root, &["init", "-b", "main"]);
    let remote_parent = temp_dir("connect-origin-remote");
    let remote = remote_parent.join("origin.git");
    run_git(
        &remote_parent,
        &["init", "--bare", remote.to_string_lossy().as_ref()],
    );

    connect_origin(&root, remote.to_string_lossy().as_ref()).unwrap();
    assert_eq!(status(&root).unwrap().remotes, vec!["origin"]);

    let error = connect_origin(&root, remote.to_string_lossy().as_ref()).unwrap_err();
    assert_eq!(error.code, GitErrorCode::RemoteAlreadyExists);
}

#[test]
/// 校验超大文本差异只返回受限内容和过大状态。
/// 入参/出参：无；断言展示内容不超过 1 MiB，且 truncated/output_too_large 均为 true。
/// 作用与流程：在本地仓库创建超过 10 MiB 的未跟踪文本，通过 no-index diff 验证 IPC 载荷边界。
fn oversized_diff_is_truncated_and_marked_too_large() {
    let root = temp_dir("oversized-diff");
    run_git(&root, &["init", "-b", "main"]);
    fs::write(root.join("large.txt"), vec![b'x'; 10 * 1024 * 1024 + 1024]).unwrap();

    let result = diff(&root, "large.txt", false, None).unwrap();
    assert!(result.truncated);
    assert!(result.output_too_large);
    assert!(result.content.len() <= 1024 * 1024);
}

#[test]
/// 校验 Git 状态读取不会触碰管理目录。
/// 入参/出参：无；断言读取状态前后的 `.git` 目录修改时间一致。
/// 作用与流程：创建含提交的临时仓库，跨过低精度文件时间窗口后调用服务层 status，防止 optional lock 再次触发 watcher。
fn status_read_does_not_touch_git_directory() {
    let root = temp_dir("status-no-optional-lock");
    run_git(&root, &["init", "-b", "main"]);
    set_identity(&root, "Test", "test@example.com").unwrap();
    fs::write(root.join("request.http"), "GET https://example.com\n").unwrap();
    stage(&root, &["request.http".to_string()]).unwrap();
    apisender_lib::git::commit(&root, "初始化测试仓库").unwrap();

    let git_dir = root.join(".git");
    thread::sleep(Duration::from_millis(1_100));
    let before = fs::metadata(&git_dir).unwrap().modified().unwrap();
    status(&root).unwrap();
    let after = fs::metadata(&git_dir).unwrap().modified().unwrap();

    assert_eq!(before, after, "只读状态查询不应创建 optional lock");
}
