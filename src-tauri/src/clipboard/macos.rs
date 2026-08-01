
use std::path::{Path, PathBuf};

use objc2::{class, msg_send};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_app_kit::NSPasteboard;
use objc2_foundation::{NSArray, NSString, NSURL};

use crate::clipboard::copy_dir;
use crate::error::AppResult;

pub fn copy(path: &str) -> AppResult<()> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let _: isize = msg_send![&pb, clearContents];
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let arr = NSArray::from_retained_slice(&[url]);
        let _: () = msg_send![&pb, writeObjects: &*arr];
    }
    Ok(())
}

pub fn paste(dest_dir: &str) -> AppResult<Vec<String>> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let url_class = class!(NSURL) as *const AnyClass as *mut AnyClass;
        let any_class: Retained<AnyClass> =
            Retained::retain(url_class).expect("NSURL class must exist");
        let classes: Retained<NSArray<AnyClass>> = NSArray::from_retained_slice(&[any_class]);
        let objects: Option<Retained<NSArray<NSURL>>> = msg_send![
            &pb,
            readObjectsForClasses: &*classes,
            options: std::ptr::null::<AnyObject>()
        ];
        let mut copied = Vec::new();
        if let Some(arr) = objects {
            for url in arr.iter() {
                let Some(path_ns) = url.path() else { continue };
                let src = path_ns.to_string();
                if src.is_empty() {
                    continue;
                }
                let Some(name) = src.rsplit('/').next().map(|s| s.to_string()) else {
                    continue;
                };
                if name.is_empty() {
                    continue;
                }
                let dest = unique_dest_path(dest_dir, &name);
                let dest_str = dest.to_string_lossy().to_string();
                if src == dest_str {
                    continue;
                }
                let src_path = Path::new(&src);
                let result = if src_path.is_dir() {
                    copy_dir(src_path, &dest)
                } else {
                    std::fs::copy(&src, &dest).map(|_| ())
                };
                if let Err(e) = result {
                    log::warn!("粘贴失败 {} -> {}: {}", src, dest_str, e);
                    continue;
                }
                copied.push(dest_str);
            }
        }
        Ok(copied)
    }
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