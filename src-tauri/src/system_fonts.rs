use tauri::WebviewWindow;

const MAX_NAME_CHARS: usize = 100;

/// Sorts family names case-insensitively and drops duplicates, hidden families (a leading `.`),
/// empty names, names over 100 characters and names with control characters.
fn clean_families(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut families: Vec<String> = names.into_iter()
        .filter(|name| !name.is_empty() && !name.starts_with('.') && name.chars().count() <= MAX_NAME_CHARS && !name.chars().any(char::is_control))
        .collect();
    families.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b)));
    families.dedup();
    families
}

#[cfg(target_os = "macos")]
fn installed_families() -> Vec<String> {
    use core_foundation::{array::{CFArray, CFArrayRef}, base::TCFType, string::CFString};
    #[link(name = "CoreText", kind = "framework")]
    unsafe extern "C" {
        // CoreText documents the font manager functions as safe to call from any thread.
        fn CTFontManagerCopyAvailableFontFamilyNames() -> CFArrayRef;
    }
    let array = unsafe { CTFontManagerCopyAvailableFontFamilyNames() };
    if array.is_null() { return Vec::new(); }
    let array: CFArray<CFString> = unsafe { CFArray::wrap_under_create_rule(array) };
    array.iter().map(|name| name.to_string()).collect()
}

#[cfg(not(target_os = "macos"))]
fn installed_families() -> Vec<String> { Vec::new() }

#[tauri::command(async)]
pub fn list_system_fonts(window: WebviewWindow) -> Result<Vec<String>, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    Ok(clean_families(installed_families()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn families_are_filtered_sorted_and_deduplicated() {
        let long = "x".repeat(101);
        let limit = "字".repeat(100);
        let names = ["Menlo", "arial", ".SF NS", "Helvetica", "Menlo", "", "Bad\u{7}Name", "Tab\tName", "苹方-简", "Arial", long.as_str(), limit.as_str(), "Zapfino"];
        let cleaned = clean_families(names.iter().map(|name| name.to_string()));
        assert_eq!(cleaned, vec!["Arial".to_string(), "arial".into(), "Helvetica".into(), "Menlo".into(), "Zapfino".into(), limit.clone(), "苹方-简".into()]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_mac_reports_its_font_families() {
        let families = clean_families(installed_families());
        assert!(!families.is_empty());
        assert!(families.iter().any(|name| name == "PingFang SC" || name == "Helvetica"), "{families:?}");
        assert!(families.iter().all(|name| !name.starts_with('.')));
    }
}
