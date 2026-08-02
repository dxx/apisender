use std::collections::HashMap;
#[cfg(unix)]
use std::path::Path;
#[cfg(windows)]
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// 启动 shell 时,显式 source 所有常见 profile 文件,然后输出 NUL 分隔的环境变量。
///
/// macOS / Linux 的 GUI 进程由 launchd / desktop file 拉起,不继承交互式 shell 的环境。
/// 因此需要 source 用户的 shell 配置。但不同 shell 的自动 source 行为不一致:
/// - zsh `-ilc`:自动 source `~/.zprofile`(login)+ `~/.zshrc`(interactive)
/// - bash `-ilc`:**只** source `~/.bash_profile`(login),**不会** source `~/.bashrc`
/// - fish `-ilc`:source `~/.config/fish/config.fish`
/// - sh `-ilc`:source `~/.profile`
///
/// 我们手动 source 所有常见文件,兼容 bash 用户把变量写在 `~/.bashrc` 的场景。
#[cfg(unix)]
fn capture_shell_env() -> Option<HashMap<String, String>> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty() && Path::new(s).exists())
        .unwrap_or_else(|| "/bin/sh".to_string());

    let home = std::env::var("HOME").unwrap_or_default();
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let mut prelude = String::new();
    if shell_name.contains("zsh") {
        append_source(&mut prelude, &home, &[".zshenv", ".zprofile", ".zshrc", ".zlogin"]);
    } else if shell_name.contains("bash") {
        append_source(
            &mut prelude,
            &home,
            &[".bash_profile", ".bash_login", ".profile", ".bashrc"],
        );
    } else if shell_name.contains("fish") {
        let fish_config = format!("{}/.config/fish/config.fish", home);
        if Path::new(&fish_config).exists() {
            prelude.push_str(&format!("[ -f \"{}\" ] && . \"{}\"; ", fish_config, fish_config));
        }
    } else {
        append_source(&mut prelude, &home, &[".profile"]);
    }
    prelude.push_str("env -0");

    let output = match Command::new(&shell).args(["-ilc", &prelude]).output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("无法启动 shell {} 捕获系统环境变量: {}", shell, e);
            return None;
        }
    };

    if !output.status.success() {
        log::warn!(
            "shell {} 退出状态非零({}),跳过系统环境变量捕获",
            shell,
            output.status
        );
        return None;
    }

    let mut map = HashMap::new();
    for entry in output.stdout.split(|&b| b == 0) {
        if entry.is_empty() {
            continue;
        }
        if let Some(eq_idx) = entry.iter().position(|&b| b == b'=') {
            let (k, v) = entry.split_at(eq_idx);
            let val = &v[1..];
            if let (Ok(key), Ok(val)) = (std::str::from_utf8(k), std::str::from_utf8(val)) {
                map.insert(key.to_string(), val.to_string());
            }
        }
    }
    log::debug!("从 {} 捕获到 {} 个系统环境变量", shell, map.len());
    Some(map)
}

#[cfg(unix)]
fn append_source(buf: &mut String, home: &str, files: &[&str]) {
    for f in files {
        let path = format!("{}/{}", home, f);
        buf.push_str(&format!("[ -f \"{}\" ] && . \"{}\"; ", path, path));
    }
}

#[cfg(unix)]
fn build_system_env() -> HashMap<String, String> {
    capture_shell_env().unwrap_or_default()
}

/// Windows 下,GUI exe 已经能拿到 Registry 中的用户环境变量
/// (通过"环境变量"对话框 / `setx` 设置的那些)。
///
/// 但写在 Git Bash `~/.bashrc` 或 PowerShell `$PROFILE` 里的 export,
/// 原生 Windows 进程**看不到**。我们尝试探测 Git Bash,若存在则 source 其配置,
/// 让用户在 `~/.bashrc` 里 export 的变量也能被 apisender 读取。
#[cfg(windows)]
fn build_system_env() -> HashMap<String, String> {
    if let Some(bash) = find_git_bash() {
        capture_bash_env(&bash).unwrap_or_default()
    } else {
        log::debug!("未检测到 Git Bash,Windows 环境变量仅来自 Registry");
        HashMap::new()
    }
}

#[cfg(windows)]
fn find_git_bash() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(programfiles) = std::env::var("ProgramFiles") {
        let p = PathBuf::from(programfiles).join("Git").join("bin").join("bash.exe");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[cfg(windows)]
fn capture_bash_env(bash: &Path) -> Option<HashMap<String, String>> {
    let home = std::env::var("USERPROFILE").ok()?;
    let bash_formatted_home = home.replace('\\', "/");

    let prelude = format!(
        r#"[ -f "{home}/.bash_profile" ] && . "{home}/.bash_profile"; [ -f "{home}/.bashrc" ] && . "{home}/.bashrc"; [ -f "{home}/.profile" ] && . "{home}/.profile"; env -0"#,
        home = bash_formatted_home
    );

    let output = Command::new(bash)
        .args(["-l", "-c", &prelude])
        .output()
        .ok()?;

    if !output.status.success() {
        log::warn!(
            "Git Bash 退出状态非零({}),跳过环境变量捕获",
            output.status
        );
        return None;
    }

    let mut map = HashMap::new();
    for entry in output.stdout.split(|&b| b == 0) {
        if entry.is_empty() {
            continue;
        }
        if let Some(eq_idx) = entry.iter().position(|&b| b == b'=') {
            let (k, v) = entry.split_at(eq_idx);
            let val = &v[1..];
            if let (Ok(key), Ok(val)) = (std::str::from_utf8(k), std::str::from_utf8(val)) {
                map.insert(key.to_string(), val.to_string());
            }
        }
    }
    Some(map)
}

#[cfg(not(any(unix, windows)))]
fn build_system_env() -> HashMap<String, String> {
    std::env::vars().collect()
}

pub fn get_system_env() -> &'static HashMap<String, String> {
    static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();
    CACHE.get_or_init(build_system_env)
}