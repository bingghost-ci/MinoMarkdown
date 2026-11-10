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
        ("toggle-source", true) => "Switch Source / Visual Mode", ("toggle-source", false) => "切换源码 / 可视化模式",
        ("find", true) => "Find and Replace…", ("find", false) => "查找和替换…",
        ("quit", true) => "Quit Mino", ("quit", false) => "退出 Mino",
        _ => "",
    }
}

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
