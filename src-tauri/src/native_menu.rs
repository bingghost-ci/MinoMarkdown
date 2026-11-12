use std::sync::{atomic::{AtomicBool, Ordering}, OnceLock};
use tauri::{AppHandle, Manager};
use tauri::menu::MenuItemKind;

static ENGLISH: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn label(id: &str, english: bool) -> &'static str {
    match (id, english) {
        ("new", true) => "New Document", ("new", false) => "新建文档",
        ("new-window", true) => "New Window", ("new-window", false) => "新建窗口",
        ("open", true) => "Open File…", ("open", false) => "打开文件…",
        ("open-folder", true) => "Open Folder…", ("open-folder", false) => "打开文件夹…",
        ("save", true) => "Save", ("save", false) => "保存",
        ("save-as", true) => "Save As…", ("save-as", false) => "另存为…",
        ("recover-drafts", true) => "Recover Drafts…", ("recover-drafts", false) => "恢复草稿…",
        ("close-tab", true) => "Close Document", ("close-tab", false) => "关闭当前文档",
        ("export-md", true) => "Export Markdown and Images…", ("export-md", false) => "导出 Markdown 与图片…",
        ("export-html", true) => "Export HTML…", ("export-html", false) => "导出 HTML…",
        ("print", true) => "Print / Save as PDF…", ("print", false) => "打印 / 存储为 PDF…",
        ("view-toolbar", true) => "Toggle File Toolbar", ("view-toolbar", false) => "显示或隐藏操作栏",
        ("view-sidebar", true) => "Toggle Sidebar", ("view-sidebar", false) => "显示或隐藏文件栏",
        ("view-outline", true) => "Toggle Outline", ("view-outline", false) => "显示或隐藏大纲",
        ("zoom-in", true) => "Increase Text Size", ("zoom-in", false) => "放大文本",
        ("zoom-out", true) => "Decrease Text Size", ("zoom-out", false) => "缩小文本",
        ("zoom-reset", true) => "Actual Text Size", ("zoom-reset", false) => "恢复默认文本大小",
        ("format", true) => "Format", ("format", false) => "格式",
        ("format-paragraph", true) => "Paragraph", ("format-paragraph", false) => "正文",
        ("format-heading1", true) => "Heading 1", ("format-heading1", false) => "标题 1",
        ("format-heading2", true) => "Heading 2", ("format-heading2", false) => "标题 2",
        ("format-heading3", true) => "Heading 3", ("format-heading3", false) => "标题 3",
        ("format-heading4", true) => "Heading 4", ("format-heading4", false) => "标题 4",
        ("format-heading5", true) => "Heading 5", ("format-heading5", false) => "标题 5",
        ("format-heading6", true) => "Heading 6", ("format-heading6", false) => "标题 6",
        ("format-bold", true) => "Bold", ("format-bold", false) => "加粗",
        ("format-italic", true) => "Italic", ("format-italic", false) => "斜体",
        ("format-strike", true) => "Strikethrough", ("format-strike", false) => "删除线",
        ("format-inline-code", true) => "Inline Code", ("format-inline-code", false) => "行内代码",
        ("format-bullet", true) => "Bulleted List", ("format-bullet", false) => "项目列表",
        ("format-ordered", true) => "Numbered List", ("format-ordered", false) => "编号列表",
        ("format-task", true) => "Task List", ("format-task", false) => "任务列表",
        ("format-quote", true) => "Quote", ("format-quote", false) => "引用",
        ("format-code-block", true) => "Code Block", ("format-code-block", false) => "代码块",
        ("format-link", true) => "Insert Link…", ("format-link", false) => "插入链接…",
        ("transform", true) => "Transform Text", ("transform", false) => "转换文本",
        ("transform-upper", true) => "Uppercase", ("transform-upper", false) => "转为大写",
        ("transform-lower", true) => "Lowercase", ("transform-lower", false) => "转为小写",
        ("transform-title", true) => "Capitalize Words", ("transform-title", false) => "单词首字母大写",
        ("transform-cjk-spacing", true) => "Add Spaces Between CJK and Latin", ("transform-cjk-spacing", false) => "中英文之间加空格",
        ("transform-full-punct", true) => "Full-width Punctuation", ("transform-full-punct", false) => "标点转全角",
        ("transform-half-punct", true) => "Half-width Punctuation", ("transform-half-punct", false) => "标点转半角",
        ("preferences", true) => "Settings…", ("preferences", false) => "设置…",
        ("open-recent", true) => "Open Recent", ("open-recent", false) => "打开最近使用",
        ("no-recent", true) => "No Recent Items", ("no-recent", false) => "没有最近使用的项目",
        ("export-text", true) => "Export Text-only Markdown…", ("export-text", false) => "导出仅正文 Markdown…",
        ("toggle-reading", true) => "Reading Mode", ("toggle-reading", false) => "阅读模式",
        ("toggle-source", true) => "Switch Source / Visual Mode", ("toggle-source", false) => "切换源码 / 可视化模式",
        ("find", true) => "Find and Replace…", ("find", false) => "查找和替换…",
        ("quit", true) => "Quit Mino", ("quit", false) => "退出 Mino",
        _ => "",
    }
}

/// Keyboard shortcuts of the menu items `lib.rs` builds, in menu order. Kept here so tests can check them.
pub const MENU_ITEMS: &[(&str, Option<&str>)] = &[
    ("new", Some("Cmd+N")),
    ("new-window", Some("Cmd+Shift+N")),
    ("open", Some("Cmd+O")),
    ("open-folder", Some("Cmd+Shift+O")),
    ("save", Some("Cmd+S")),
    ("save-as", Some("Cmd+Shift+S")),
    ("recover-drafts", None),
    ("close-tab", Some("Cmd+W")),
    ("export-md", None),
    ("export-text", None),
    ("export-html", None),
    ("print", Some("Cmd+P")),
    ("find", Some("Cmd+F")),
    ("toggle-reading", Some("Cmd+Shift+R")),
    ("toggle-source", None),
    ("view-toolbar", None),
    ("view-sidebar", None),
    ("view-outline", None),
    ("zoom-in", Some("Cmd+=")),
    ("zoom-out", Some("Cmd+-")),
    ("zoom-reset", Some("Cmd+0")),
    ("preferences", Some("Cmd+,")),
    ("quit", Some("Cmd+Q")),
    ("format-paragraph", Some("Cmd+Alt+0")),
    ("format-heading1", Some("Cmd+Alt+1")),
    ("format-heading2", Some("Cmd+Alt+2")),
    ("format-heading3", Some("Cmd+Alt+3")),
    ("format-heading4", Some("Cmd+Alt+4")),
    ("format-heading5", Some("Cmd+Alt+5")),
    ("format-heading6", Some("Cmd+Alt+6")),
    ("format-bold", Some("Cmd+B")),
    ("format-italic", Some("Cmd+I")),
    ("format-strike", Some("Cmd+Alt+X")),
    ("format-inline-code", Some("Cmd+E")),
    ("format-bullet", Some("Cmd+Alt+8")),
    ("format-ordered", Some("Cmd+Alt+7")),
    ("format-task", None),
    ("format-quote", Some("Cmd+Shift+B")),
    ("format-code-block", Some("Cmd+Alt+C")),
    ("format-link", Some("Cmd+K")),
    ("transform-upper", None),
    ("transform-lower", None),
    ("transform-title", None),
    ("transform-cjk-spacing", None),
    ("transform-full-punct", None),
    ("transform-half-punct", None),
];

/// A menu item with the label and shortcut this file gives its id.
pub fn item(app: &AppHandle, id: &str, english: bool) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    tauri::menu::MenuItem::with_id(app, id, label(id, english), true, accelerator(id))
}

pub fn accelerator(id: &str) -> Option<&'static str> {
    MENU_ITEMS.iter().find(|(item, _)| *item == id).and_then(|(_, shortcut)| *shortcut)
}

/// The language the menu is in, without reading the settings file again.
pub fn english() -> bool { ENGLISH.load(Ordering::Relaxed) }
/// Records the language the menu was just built in.
pub fn built_in(english: bool) { ENGLISH.store(english, Ordering::Relaxed); }

pub fn set_language(app: &AppHandle, language: &str) {
    let english = language == "en-US";
    ENGLISH.store(english, Ordering::Relaxed);
    if let Some(menu) = app.menu() {
        if let Ok(items) = menu.items() {
            for item in items {
                relabel(&item, english);
            }
        }
    }
}

/// Whether a menu item applies to the kind of document in front (T88). The frontend refuses the same actions
/// on its own, so this only keeps the menu honest.
pub fn enabled_for(id: &str, kind: &str) -> bool {
    let formatting = id == "format" || id == "transform" || id.starts_with("format-") || id.starts_with("transform-");
    match kind {
        // A PDF is read-only: nothing to save, export, print from here or switch to source.
        "pdf" => !(formatting || matches!(id, "save" | "save-as" | "export-md" | "export-text" | "export-html" | "print" | "toggle-source" | "toggle-reading")),
        // Text and source files have no Markdown structure.
        "text" | "code" => !(formatting || matches!(id, "export-md" | "export-text" | "toggle-source")),
        _ => true,
    }
}

/// Must run on the main thread.
pub fn set_document_kind(app: &AppHandle, kind: &str) {
    fn apply(item: &MenuItemKind<tauri::Wry>, kind: &str) {
        match item {
            MenuItemKind::MenuItem(item) => { let _ = item.set_enabled(enabled_for(item.id().as_ref(), kind)); }
            MenuItemKind::Submenu(submenu) => {
                let id = submenu.id().as_ref().to_owned();
                if id == "format" || id == "transform" { let _ = submenu.set_enabled(enabled_for(&id, kind)); }
                if let Ok(children) = submenu.items() { for child in &children { apply(child, kind); } }
            }
            _ => {}
        }
    }
    if let Some(menu) = app.menu() {
        if let Ok(items) = menu.items() { for item in &items { apply(item, kind); } }
    }
}

/// The kind the menu was last set for. Every window reports its kind each time it is focused; when the kind
/// is the one already applied there is nothing to change, and walking the menu to set some sixty items to the
/// state they already have is skipped (T99).
static APPLIED_KIND: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
fn kind_changes(kind: &str) -> bool {
    let Ok(mut applied) = APPLIED_KIND.lock() else { return true };
    if *applied == kind { return false; }
    kind.clone_into(&mut applied);
    true
}

#[tauri::command]
pub fn set_menu_state(app: AppHandle, window: tauri::WebviewWindow, kind: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    if !matches!(kind.as_str(), "markdown" | "text" | "code" | "pdf") { return Err("INVALID_KIND".into()); }
    if !kind_changes(&kind) { return Ok(()); }
    let handle = app.clone();
    app.run_on_main_thread(move || set_document_kind(&handle, &kind)).map_err(|_| "IO_ERROR".into())
}

fn relabel(item: &MenuItemKind<tauri::Wry>, english: bool) {
    match item {
        MenuItemKind::MenuItem(item) => {
            let translated = label(item.id().as_ref(), english);
            if !translated.is_empty() { let _ = item.set_text(translated); }
        }
        MenuItemKind::Submenu(submenu) => {
            let translated = label(submenu.id().as_ref(), english);
            if !translated.is_empty() { let _ = submenu.set_text(translated); }
            if let Ok(children) = submenu.items() {
                for child in &children { relabel(child, english); }
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
pub fn install_dock_menu(app: &AppHandle) {
    use objc2::{ffi, runtime::{AnyClass, AnyObject, Imp, Sel}};
    let _ = APP.set(app.clone());
    // Tao owns the application delegate. Add only the optional Dock callbacks to its class.
    unsafe {
        let Some(class) = AnyClass::get(c"TaoAppDelegateParent") else { return };
        let dock: Imp = std::mem::transmute(dock_menu as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject);
        let action: Imp = std::mem::transmute(new_window as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject));
        let terminate: Imp = std::mem::transmute(should_terminate as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> isize);
        let _ = ffi::class_addMethod(class as *const _ as *mut _, objc2::sel!(applicationDockMenu:), dock, c"@@:@".as_ptr());
        let _ = ffi::class_addMethod(class as *const _ as *mut _, objc2::sel!(minoNewWindow:), action, c"v@:@".as_ptr());
        let _ = ffi::class_addMethod(class as *const _ as *mut _, objc2::sel!(applicationShouldTerminate:), terminate, c"q@:@".as_ptr());
    }
}

#[cfg(target_os = "macos")]
extern "C" fn dock_menu(this: *mut objc2::runtime::AnyObject, _: objc2::runtime::Sel, _: *mut objc2::runtime::AnyObject) -> *mut objc2::runtime::AnyObject {
    use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSMenu, NSMenuItem};
    use objc2_foundation::NSString;
    let Some(mtm) = MainThreadMarker::new() else { return std::ptr::null_mut() };
    let menu = NSMenu::new(mtm);
    let title = NSString::from_str(label("new-window", ENGLISH.load(Ordering::Relaxed)));
    let empty = NSString::from_str("");
    let item = unsafe { NSMenuItem::initWithTitle_action_keyEquivalent(NSMenuItem::alloc(mtm), &title, Some(objc2::sel!(minoNewWindow:)), &empty) };
    unsafe { item.setTarget(this.as_ref()) };
    menu.addItem(&item);
    Retained::autorelease_return(menu).cast::<AnyObject>()
}

#[cfg(target_os = "macos")]
extern "C" fn new_window(_: *mut objc2::runtime::AnyObject, _: objc2::runtime::Sel, _: *mut objc2::runtime::AnyObject) {
    if let Some(app) = APP.get() {
        let _ = crate::windows::create(app, &app.state::<crate::windows::TransferStore>(), None);
    }
}

#[cfg(target_os = "macos")]
extern "C" fn should_terminate(_: *mut objc2::runtime::AnyObject, _: objc2::runtime::Sel, _: *mut objc2::runtime::AnyObject) -> isize {
    use tauri::Emitter;
    if let Some(app) = APP.get() {
        let windows: Vec<_> = app.webview_windows().into_values()
            .filter(|window| crate::is_workspace_window(window.label()))
            .collect();
        if !windows.is_empty() {
            for window in windows { let _ = app.emit_to(window.label(), "app-quit-requested", ()); }
            return 0; // NSTerminateCancel: Webviews close after their save/confirm flow.
        }
    }
    1 // NSTerminateNow
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn the_menu_is_set_again_only_when_the_kind_of_document_changes() {
        // The first report of a kind applies it; the same kind again, as on every window focus, does not.
        assert!(kind_changes("pdf"));
        assert!(!kind_changes("pdf"));
        assert!(!kind_changes("pdf"));
        assert!(kind_changes("markdown"));
        assert!(!kind_changes("markdown"));
        assert!(kind_changes("pdf"));
    }
    #[test]
    fn the_language_the_menu_was_built_in_is_remembered() {
        built_in(true);
        assert!(english());
        built_in(false);
        assert!(!english());
    }

    #[test]
    fn reading_mode_has_its_shortcut_and_both_labels() {
        assert_eq!(accelerator("toggle-reading"), Some("Cmd+Shift+R"));
        assert_eq!(label("toggle-reading", false), "阅读模式");
        assert_eq!(label("toggle-reading", true), "Reading Mode");
        // ⌘E stays with inline code (doc/08 §8).
        assert_eq!(accelerator("format-inline-code"), Some("Cmd+E"));
    }

    #[test]
    fn menu_items_follow_the_kind_of_document() {
        for (id, _) in MENU_ITEMS { assert!(enabled_for(id, "markdown"), "{id}"); }
        for id in ["save", "save-as", "export-md", "export-text", "export-html", "print", "toggle-source", "toggle-reading", "format", "format-bold", "transform-upper"] { assert!(!enabled_for(id, "pdf"), "{id}"); }
        for id in ["new", "open", "open-folder", "close-tab", "find", "zoom-in", "zoom-out", "zoom-reset", "view-outline", "view-sidebar", "preferences", "quit", "new-window", "recover-drafts"] { for kind in ["pdf", "text", "code"] { assert!(enabled_for(id, kind), "{id} {kind}"); } }
        for kind in ["text", "code"] {
            for id in ["save", "save-as", "export-html", "print", "toggle-reading"] { assert!(enabled_for(id, kind), "{id} {kind}"); }
            for id in ["export-md", "export-text", "toggle-source", "format", "format-heading1", "format-link", "transform", "transform-lower"] { assert!(!enabled_for(id, kind), "{id} {kind}"); }
        }
    }

    #[test]
    fn every_menu_item_is_labeled_in_both_languages_and_shortcuts_do_not_collide() {
        let mut seen = HashSet::new();
        for (id, shortcut) in MENU_ITEMS {
            assert!(!label(id, false).is_empty() && !label(id, true).is_empty(), "{id}");
            if let Some(shortcut) = shortcut { assert!(seen.insert(*shortcut), "{id} reuses {shortcut}"); }
        }
        let ids: HashSet<_> = MENU_ITEMS.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids.len(), MENU_ITEMS.len());
        assert!(ids.contains("toggle-reading"));
    }
}
