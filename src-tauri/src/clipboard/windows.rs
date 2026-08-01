
use std::path::{Path, PathBuf};

use windows::Win32::Foundation::{HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalUnlock, GHND,
};
use windows::Win32::System::Ole::CF_HDROP;

use crate::clipboard::copy_dir;
use crate::error::{AppError, AppResult};

const DROPFILES_SIZE: usize = std::mem::size_of::<DropFiles>();

#[repr(C)]
struct DropFiles {
    p_files: u32,
    pt_x: i32,
    pt_y: i32,
    f_nc: i32,
    f_aw: u32,
}

pub fn copy(path: &str) -> AppResult<()> {
    unsafe {
        let abs_path = std::fs::canonicalize(path)
            .map_err(|e| AppError::Clipboard(format!("解析路径失败: {}", e)))?;
        // canonicalize 在 Windows 上返回 UNC 扩展长度路径 `\\?\C:\...`，
        // 这种路径放进 CF_HDROP 后部分程序（如资源管理器）无法识别，去掉前缀转成普通 `C:\...` 格式
        let abs_str = abs_path
            .to_string_lossy()
            .strip_prefix(r"\\?\")
            .map(|s| s.to_string())
            .unwrap_or_else(|| abs_path.to_string_lossy().to_string());

        let mut bytes: Vec<u16> = abs_str.encode_utf16().collect();
        bytes.push(0); // 路径字符串结尾 null
        bytes.push(0); // 双 null 结尾（DROPFILES 要求）

        let payload_size = DROPFILES_SIZE + bytes.len() * 2;
        let h_global = GlobalAlloc(GHND, payload_size)
            .map_err(|e| AppError::Clipboard(format!("GlobalAlloc 失败: {}", e)))?;

        let ptr = GlobalLock(h_global);
        if ptr.is_null() {
            return Err(AppError::Clipboard("GlobalLock 失败".into()));
        }

        let mut dropfiles = DropFiles {
            p_files: DROPFILES_SIZE as u32,
            pt_x: 0,
            pt_y: 0,
            f_nc: 0,
            f_aw: 1, // Unicode：路径以 UTF-16 写入
        };

        std::ptr::copy_nonoverlapping(
            &mut dropfiles as *mut _ as *mut u8,
            ptr as *mut u8,
            DROPFILES_SIZE,
        );
        std::ptr::copy_nonoverlapping(
            bytes.as_ptr() as *const u8,
            (ptr as *mut u8).add(DROPFILES_SIZE),
            bytes.len() * 2,
        );

        let _ = GlobalUnlock(h_global);

        if !OpenClipboard(None).is_ok() {
            return Err(AppError::Clipboard("OpenClipboard 失败".into()));
        }
        let _ = EmptyClipboard();
        if SetClipboardData(CF_HDROP.0.into(), HANDLE(h_global.0)).is_err() {
            let _ = CloseClipboard();
            return Err(AppError::Clipboard("SetClipboardData 失败".into()));
        }
        let _ = CloseClipboard();
    }
    Ok(())
}

pub fn paste(dest_dir: &str) -> AppResult<Vec<String>> {
    unsafe {
        if !OpenClipboard(None).is_ok() {
            return Err(AppError::Clipboard("OpenClipboard 失败".into()));
        }

        let h_global = windows::Win32::System::DataExchange::GetClipboardData(CF_HDROP.0.into());
        let result = if let Ok(h) = h_global {
            let ptr = GlobalLock(HGLOBAL(h.0));
            if !ptr.is_null() {
                extract_paths(ptr, dest_dir)
            } else {
                Ok(Vec::new())
            }
        } else {
            Ok(Vec::new())
        };

        let _ = CloseClipboard();
        result
    }
}

unsafe fn extract_paths(ptr: *mut core::ffi::c_void, dest_dir: &str) -> AppResult<Vec<String>> {
    let dropfiles = unsafe { &*(ptr as *const DropFiles) };
    let files_offset = dropfiles.p_files as isize;
    let base = unsafe { (ptr as *const u16).offset(files_offset / 2) };

    let mut copied = Vec::new();
    let mut idx = 0isize;
    loop {
        let c = unsafe { *base.offset(idx) };
        if c == 0 {
            break;
        }
        let start = idx;
        while unsafe { *base.offset(idx) } != 0 {
            idx += 1;
        }
        let slice = unsafe { std::slice::from_raw_parts(base.offset(start), (idx - start) as usize) };
        let path = String::from_utf16_lossy(slice);
        idx += 1; // skip null terminator

        if let Some(name) = path.rsplit('\\').next() {
            if name.is_empty() {
                continue;
            }
            let dest = unique_dest_path(dest_dir, name);
            let dest_str = dest.to_string_lossy().to_string();
            if path == dest_str {
                continue;
            }
            let src_path = Path::new(&path);
            let result = if src_path.is_dir() {
                copy_dir(src_path, &dest)
            } else {
                std::fs::copy(&path, &dest).map(|_| ())
            };
            if let Err(e) = result {
                log::warn!("粘贴失败 {} -> {}: {}", path, dest_str, e);
                continue;
            }
            copied.push(dest_str);
        }
    }
    Ok(copied)
}

fn unique_dest_path(dest_dir: &str, file_name: &str) -> PathBuf {
    let dir = PathBuf::from(dest_dir);
    let original = dir.join(file_name);
    if !original.exists() {
        return original;
    }
    let stem = original
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());
    let ext = original
        .extension()
        .map(|e| e.to_string_lossy().to_string());
    for n in 1..1000 {
        let new_name = match &ext {
            Some(e) => format!("{} ({}).{}", stem, n, e),
            None => format!("{} ({})", stem, n),
        };
        let p = dir.join(&new_name);
        if !p.exists() {
            return p;
        }
    }
    original
}