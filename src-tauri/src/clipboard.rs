
use std::io;
use std::path::Path;

use crate::error::AppResult;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;

pub fn copy_file(path: &str) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    return macos::copy(path);
    #[cfg(target_os = "windows")]
    return windows::copy(path);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return stub::copy(path);
}

pub fn paste_files(dest_dir: &str) -> AppResult<Vec<String>> {
    #[cfg(target_os = "macos")]
    return macos::paste(dest_dir);
    #[cfg(target_os = "windows")]
    return windows::paste(dest_dir);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return stub::paste(dest_dir);
}

pub(crate) fn copy_dir(src: &Path, dest: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if ft.is_dir() {
            copy_dir(&src_path, &dest_path)?;
        } else if ft.is_symlink() {
            continue;
        } else {
            std::fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}
