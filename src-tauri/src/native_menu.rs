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
        ("preferences", true) => "Settings…", ("preferences", false) => "设置…",
        ("open-recent", true) => "Open Recent", ("open-recent", false) => "打开最近使用",
        ("no-recent", true) => "No Recent Items", ("no-recent", false) => "没有最近使用的项目",
        ("export-text", true) => "Export Text-only Markdown…", ("export-text", false) => "导出仅正文 Markdown…",
        ("toggle-source", true) => "Switch Source / Visual Mode", ("toggle-source", false) => "切换源码 / 可视化模式",
        ("find", true) => "Find and Replace…", ("find", false) => "查找和替换…",
        ("quit", true) => "Quit MinoMarkdown", ("quit", false) => "退出 MinoMarkdown",
        _ => "",
    }
}

pub fn set_language(app: &AppHandle, language: &str) {
    let english = language == "en-US";
    ENGLISH.store(english, Ordering::Relaxed);
    if let Some(menu) = app.menu() {
        if let Ok(items) = menu.items() {
            for item in items {
                if let MenuItemKind::Submenu(submenu) = item {
                    if let Ok(children) = submenu.items() {
                        for child in children {
                            if let MenuItemKind::MenuItem(item) = &child {
                                let translated = label(item.id().as_ref(), english);
                                if !translated.is_empty() { let _ = item.set_text(translated); }
                            }
                            if let MenuItemKind::Submenu(item) = &child {
                                let translated = label(item.id().as_ref(), english);
                                if !translated.is_empty() { let _ = item.set_text(translated); }
                            }
                        }
                    }
                }
            }
        }
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
