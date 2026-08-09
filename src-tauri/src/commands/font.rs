use font_kit::source::SystemSource;

#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    SystemSource::new()
        .all_families()
        .map(|names| {
            let mut sorted = names;
            sorted.sort();
            sorted.dedup();
            sorted
        })
        .unwrap_or_default()
}