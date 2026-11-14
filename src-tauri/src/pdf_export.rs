//! Export as PDF and Print, done natively (T106).
//!
//! The page the frontend renders (the same sanitized, self-contained HTML as an HTML export) is loaded into an
//! offscreen WebKit view with JavaScript turned off and printed by AppKit: straight to a file for “Export PDF”, or
//! through the system print panel for “Print”. A webview cannot print from `window.print()` inside Tauri, which is
//! why the old button did nothing.
//!
//! WebKit leaves the `@page` margins unpainted (T52), so an exported PDF is printed without any page background and
//! the paper color is then painted under every page as a whole, with PDFKit, which keeps the text, the fonts and the
//! links of the printed file. The page therefore has the reading style's color edge to edge and the normal margins
//! on every page.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// The rendered page carries its fonts and images, like an HTML export, and may be as large.
const MAX_PAGE_BYTES: usize = 100 * 1024 * 1024;
/// Loading the page and printing it to a file; a print panel waits for the user as long as it is open.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(180);
const PRINT_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

static NEXT_JOB: AtomicU64 = AtomicU64::new(1);

/// Paper size in points.
pub(crate) fn paper_size(name: &str) -> Result<(f64, f64), String> {
    match name {
        "a4" => Ok((595.28, 841.89)),
        "letter" => Ok((612.0, 792.0)),
        _ => Err("INVALID_ARGUMENT".into()),
    }
}

/// A `#rrggbb` color as components from 0 to 1.
pub(crate) fn paper_color(value: &str) -> Result<[f64; 3], String> {
    let hex = value.strip_prefix('#').filter(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit())).ok_or("INVALID_ARGUMENT")?;
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).map(|v| f64::from(v) / 255.0).map_err(|_| "INVALID_ARGUMENT".to_string());
    Ok([channel(0)?, channel(2)?, channel(4)?])
}

/// The name the save panel suggests: the document's title without characters a file name cannot hold.
pub(crate) fn suggested_name(title: &str) -> String {
    let stem: String = title.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':')).take(120).collect();
    let stem = stem.trim().trim_start_matches('.');
    let stem = stem.strip_suffix(".md").or_else(|| stem.strip_suffix(".markdown")).unwrap_or(stem).trim();
    format!("{}.pdf", if stem.is_empty() { "Untitled" } else { stem })
}

fn check_page(html: &str) -> Result<(), String> {
    if html.len() > MAX_PAGE_BYTES { return Err("EXPORT_TOO_LARGE".into()); }
    Ok(())
}

/// A private folder for the intermediate files, removed when the export ends.
struct WorkDir(PathBuf);
impl WorkDir {
    fn new() -> Result<Self, String> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let path = std::env::temp_dir().join(format!("mino-pdf-{}-{}-{nanos}", std::process::id(), NEXT_JOB.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path).map_err(|_| "IO_ERROR")?;
        Ok(Self(path))
    }
}
impl Drop for WorkDir {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

/// Saves the page as a PDF where the user chooses, with the paper color under every page.
/// Returns the file name, or `None` when the save panel was canceled.
#[tauri::command(async)]
pub fn export_pdf(app: AppHandle, window: WebviewWindow, html: String, title: String, paper: String, page_size: String) -> Result<Option<String>, String> {
    crate::require_workspace_window(&window)?;
    check_page(&html)?;
    let color = paper_color(&paper)?;
    let size = paper_size(&page_size)?;
    let selected = app.dialog().file().add_filter("PDF", &["pdf"]).set_file_name(suggested_name(&title)).set_parent(&window).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "INVALID_PATH")?;
    if !path.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("pdf")) {
        return Err("UNSUPPORTED_FILE_TYPE".into());
    }
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    // The save panel has already asked whether to replace an existing file.
    if fs::symlink_metadata(&path).is_ok_and(|meta| !meta.is_file()) { return Err("INVALID_PATH".into()); }

    let work = WorkDir::new()?;
    let printed = work.0.join("printed.pdf");
    let painted = work.0.join("painted.pdf");
    if !mac::run(&app, mac::Job { html, title, size, target: mac::Target::File(printed.clone()) }, EXPORT_TIMEOUT)? {
        return Err("EXPORT_FAILED".into());
    }
    mac::paint_paper(&printed, &painted, color)?;
    let bytes = fs::read(&painted).map_err(|_| "IO_ERROR")?;
    if bytes.len() < 8 || !bytes.starts_with(b"%PDF") { return Err("EXPORT_FAILED".into()); }
    crate::fs::write_chosen_file(&path, bytes, crate::fs::CHOSEN_FILE_TIMEOUT)?;
    Ok(Some(path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()))
}

/// Shows the system print panel for the page. Returns whether it was printed (false when canceled).
#[tauri::command(async)]
pub fn print_page(app: AppHandle, window: WebviewWindow, html: String, title: String, page_size: String) -> Result<bool, String> {
    crate::require_workspace_window(&window)?;
    check_page(&html)?;
    let size = paper_size(&page_size)?;
    mac::run(&app, mac::Job { html, title, size, target: mac::Target::Panel(window.label().to_owned()) }, PRINT_TIMEOUT)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::{self, Sender};
    use std::sync::Mutex;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, NSObject};
    use objc2::{class, define_class, extern_class, msg_send, sel, AllocAnyThread, DefinedClass, MainThreadMarker};
    use objc2_core_graphics::CGContext;
    use objc2_foundation::{NSNumber, NSPoint, NSRect, NSSize, NSString, NSURL};
    use tauri::{AppHandle, Manager};

    #[link(name = "PDFKit", kind = "framework")]
    unsafe extern "C" {}

    pub enum Target {
        /// Print straight to this file, without any panel.
        File(PathBuf),
        /// Show the print panel as a sheet on this window.
        Panel(String),
    }

    pub struct Job {
        pub html: String,
        pub title: String,
        pub size: (f64, f64),
        pub target: Target,
    }

    /// The AppKit and WebKit objects of a job; they live on the main thread.
    struct Running {
        delegate: Retained<JobDelegate>,
        window: Retained<AnyObject>,
        web: Retained<AnyObject>,
        title: String,
        size: (f64, f64),
        target: Target,
        app: AppHandle,
    }

    thread_local! {
        static RUNNING: RefCell<HashMap<u64, Running>> = RefCell::new(HashMap::new());
    }
    /// Where each job's outcome goes. AppKit may report a print without a panel from its own thread, so this is
    /// not kept with the main-thread objects.
    type Outcome = Sender<Result<bool, String>>;
    static WAITING: Mutex<Option<HashMap<u64, Outcome>>> = Mutex::new(None);

    /// Runs a job on the main thread and waits for it. The webview and window are let go afterwards, from a later
    /// turn of the main loop, never from inside one of their own callbacks.
    pub fn run(app: &AppHandle, job: Job, timeout: Duration) -> Result<bool, String> {
        let id = super::NEXT_JOB.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (done, result) = mpsc::channel();
        waiting(|senders| { senders.insert(id, done); });
        let handle = app.clone();
        if app.run_on_main_thread(move || start(id, job, handle)).is_err() {
            waiting(|senders| { senders.remove(&id); });
            return Err("EXPORT_FAILED".into());
        }
        let outcome = result.recv_timeout(timeout).unwrap_or_else(|_| Err("EXPORT_TIMEOUT".into()));
        waiting(|senders| { senders.remove(&id); });
        let _ = app.run_on_main_thread(move || finish(id));
        outcome
    }

    fn finish(id: u64) {
        let running = RUNNING.with(|jobs| jobs.borrow_mut().remove(&id));
        if let Some(running) = running {
            unsafe {
                let _: () = msg_send![&*running.web, setNavigationDelegate: Option::<&AnyObject>::None];
                let _: () = msg_send![&*running.web, stopLoading];
                let _: () = msg_send![&*running.window, setContentView: Option::<&AnyObject>::None];
                let _: () = msg_send![&*running.window, close];
            }
        }
    }

    fn waiting<T>(change: impl FnOnce(&mut HashMap<u64, Outcome>) -> T) -> T {
        let mut senders = WAITING.lock().unwrap_or_else(|e| e.into_inner());
        change(senders.get_or_insert_with(HashMap::new))
    }

    /// The first outcome of a job is the one that counts.
    fn report(id: u64, outcome: Result<bool, String>) {
        if let Some(done) = waiting(|senders| senders.remove(&id)) { let _ = done.send(outcome); }
    }

    fn start(id: u64, job: Job, app: AppHandle) {
        if MainThreadMarker::new().is_none() { report(id, Err("EXPORT_FAILED".into())); return; }
        unsafe {
            let config: Retained<AnyObject> = msg_send![class!(WKWebViewConfiguration), new];
            // The page is static and its own CSP already forbids scripts and remote loads.
            let preferences: Retained<AnyObject> = msg_send![&*config, defaultWebpagePreferences];
            let _: () = msg_send![&*preferences, setAllowsContentJavaScript: false];
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(900.0, 1200.0));
            let web: Retained<AnyObject> = msg_send![msg_send![class!(WKWebView), alloc], initWithFrame: frame, configuration: &*config];
            // Nothing is painted where the page sets no background, so the paper can be put under it afterwards.
            let _: () = msg_send![&*web, setValue: &*NSNumber::new_bool(false), forKey: &*NSString::from_str("drawsBackground")];
            let delegate = JobDelegate::new(id);
            let _: () = msg_send![&*web, setNavigationDelegate: &*delegate];
            let window_frame = NSRect::new(NSPoint::new(-20000.0, -20000.0), NSSize::new(900.0, 1200.0));
            // Borderless, buffered; never shown in front or listed in the Window menu.
            let window: Retained<AnyObject> = msg_send![msg_send![class!(NSWindow), alloc], initWithContentRect: window_frame, styleMask: 0usize, backing: 2usize, defer: false];
            let _: () = msg_send![&*window, setReleasedWhenClosed: false];
            let _: () = msg_send![&*window, setExcludedFromWindowsMenu: true];
            let _: () = msg_send![&*window, setContentView: &*web];
            let _: () = msg_send![&*window, orderBack: Option::<&AnyObject>::None];
            let html = NSString::from_str(&job.html);
            let _: Option<Retained<AnyObject>> = msg_send![&*web, loadHTMLString: &*html, baseURL: Option::<&NSURL>::None];
            let Job { title, size, target, .. } = job;
            RUNNING.with(|jobs| jobs.borrow_mut().insert(id, Running { delegate, window, web, title, size, target, app }));
        }
    }

    /// The page has loaded: wait for its fonts and images, then print.
    fn loaded(id: u64) {
        let web = RUNNING.with(|jobs| jobs.borrow().get(&id).map(|running| running.web.clone()));
        let Some(web) = web else { return };
        let block = RcBlock::new(move |_result: *mut AnyObject, _error: *mut AnyObject| print(id));
        unsafe {
            let world: Retained<AnyObject> = msg_send![class!(WKContentWorld), defaultClientWorld];
            let body = NSString::from_str("await document.fonts.ready; await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => null))); return 1");
            let _: () = msg_send![&*web, callAsyncJavaScript: &*body, arguments: Option::<&AnyObject>::None, inFrame: Option::<&AnyObject>::None, inContentWorld: &*world, completionHandler: &*block];
        }
    }

    fn print(id: u64) {
        let ready = RUNNING.with(|jobs| jobs.borrow().get(&id).map(|running| {
            let (parent, file) = match &running.target {
                Target::File(path) => (None, Some(path.clone())),
                Target::Panel(label) => (running.app.get_webview_window(label).and_then(|window| window.ns_window().ok()).map(|pointer| pointer as usize), None),
            };
            (running.web.clone(), running.window.clone(), running.delegate.clone(), parent, running.size, running.title.clone(), file)
        }));
        let Some((web, offscreen, delegate, parent, (width, height), title, file)) = ready else { return };
        if file.is_none() && parent.is_none() { report(id, Err("EXPORT_FAILED".into())); return; }
        unsafe {
            let shared: Retained<AnyObject> = msg_send![class!(NSPrintInfo), sharedPrintInfo];
            let info: Retained<AnyObject> = msg_send![&*shared, copy];
            let _: () = msg_send![&*info, setPaperSize: NSSize::new(width, height)];
            // The page's own `@page` margins apply; AppKit adds none.
            let _: () = msg_send![&*info, setTopMargin: 0.0f64];
            let _: () = msg_send![&*info, setBottomMargin: 0.0f64];
            let _: () = msg_send![&*info, setLeftMargin: 0.0f64];
            let _: () = msg_send![&*info, setRightMargin: 0.0f64];
            let _: () = msg_send![&*info, setHorizontalPagination: 0usize];
            let _: () = msg_send![&*info, setVerticalPagination: 0usize];
            let _: () = msg_send![&*info, setHorizontallyCentered: false];
            let _: () = msg_send![&*info, setVerticallyCentered: false];
            if let Some(path) = &file {
                let Some(url) = NSURL::from_file_path(path) else { report(id, Err("EXPORT_FAILED".into())); return; };
                let dictionary: Retained<AnyObject> = msg_send![&*info, dictionary];
                let _: () = msg_send![&*dictionary, setObject: objc2_app_kit::NSPrintSaveJob, forKey: objc2_app_kit::NSPrintJobDisposition];
                let _: () = msg_send![&*dictionary, setObject: &*url, forKey: objc2_app_kit::NSPrintJobSavingURL];
            }
            let operation: Retained<AnyObject> = msg_send![&*web, printOperationWithPrintInfo: &*info];
            let panel = file.is_none();
            let _: () = msg_send![&*operation, setShowsPrintPanel: panel];
            let _: () = msg_send![&*operation, setShowsProgressPanel: panel];
            let _: () = msg_send![&*operation, setJobTitle: &*NSString::from_str(&title)];
            if panel {
                let print_panel: Retained<AnyObject> = msg_send![&*operation, printPanel];
                // Copies, page range, paper size, orientation, scale and the preview.
                let _: () = msg_send![&*print_panel, setOptions: (1usize | 2 | 4 | 8 | 16 | (1 << 17))];
            }
            let view: Option<Retained<AnyObject>> = msg_send![&*operation, view];
            if let Some(view) = view {
                let bounds: NSRect = msg_send![&*web, bounds];
                let _: () = msg_send![&*view, setFrame: bounds];
            }
            let host: &AnyObject = match parent { Some(pointer) => &*(pointer as *const AnyObject), None => &offscreen };
            let _: () = msg_send![&*operation, runOperationModalForWindow: host, delegate: &*delegate, didRunSelector: sel!(printOperationDidRun:success:contextInfo:), contextInfo: std::ptr::null_mut::<c_void>()];
        }
    }

    pub struct DelegateIvars { id: u64 }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "MinoPrintJobDelegate"]
        #[ivars = DelegateIvars]
        pub struct JobDelegate;

        impl JobDelegate {
            #[unsafe(method(webView:didFinishNavigation:))]
            fn did_finish(&self, _web: &AnyObject, _navigation: *mut AnyObject) { loaded(self.ivars().id); }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail(&self, _web: &AnyObject, _navigation: *mut AnyObject, _error: *mut AnyObject) { report(self.ivars().id, Err("EXPORT_FAILED".into())); }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_early(&self, _web: &AnyObject, _navigation: *mut AnyObject, _error: *mut AnyObject) { report(self.ivars().id, Err("EXPORT_FAILED".into())); }

            #[unsafe(method(webViewWebContentProcessDidTerminate:))]
            fn terminated(&self, _web: &AnyObject) { report(self.ivars().id, Err("EXPORT_FAILED".into())); }

            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn printed(&self, _operation: &AnyObject, success: Bool, _context: *mut c_void) { report(self.ivars().id, Ok(success.as_bool())); }
        }
    );

    impl JobDelegate {
        fn new(id: u64) -> Retained<Self> {
            let this = Self::alloc().set_ivars(DelegateIvars { id });
            unsafe { msg_send![super(this), init] }
        }
    }

    extern_class!(
        #[unsafe(super(NSObject))]
        #[name = "PDFPage"]
        pub struct PdfPage;
    );

    /// The paper under the pages being written; one document is painted at a time.
    static PAPER: Mutex<[f64; 3]> = Mutex::new([1.0, 1.0, 1.0]);
    static PAINTING: Mutex<()> = Mutex::new(());

    define_class!(
        #[unsafe(super(PdfPage, NSObject))]
        #[name = "MinoPaperPage"]
        pub struct PaperPage;

        impl PaperPage {
            #[unsafe(method(drawWithBox:toContext:))]
            fn draw(&self, kind: isize, context: Option<&CGContext>) {
                if let Some(context) = context {
                    let [red, green, blue] = *PAPER.lock().unwrap_or_else(|e| e.into_inner());
                    let bounds: NSRect = unsafe { msg_send![self, boundsForBox: kind] };
                    CGContext::save_g_state(Some(context));
                    CGContext::set_rgb_fill_color(Some(context), red, green, blue, 1.0);
                    CGContext::fill_rect(Some(context), bounds);
                    CGContext::restore_g_state(Some(context));
                }
                let _: () = unsafe { msg_send![super(self), drawWithBox: kind, toContext: context] };
            }
        }
    );

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "MinoPaperDocumentDelegate"]
        pub struct PaperDelegate;

        impl PaperDelegate {
            #[unsafe(method(classForPage))]
            fn class_for_page(&self) -> &'static AnyClass { <PaperPage as objc2::ClassType>::class() }
        }
    );

    /// Writes `printed` again as `painted` with the paper color under every page. PDFKit keeps the text, the
    /// embedded fonts and the link annotations of the printed file.
    pub fn paint_paper(printed: &Path, painted: &Path, color: [f64; 3]) -> Result<(), String> {
        let _painting = PAINTING.lock().unwrap_or_else(|e| e.into_inner());
        *PAPER.lock().unwrap_or_else(|e| e.into_inner()) = color;
        let source = NSURL::from_file_path(printed).ok_or("EXPORT_FAILED")?;
        let target = NSURL::from_file_path(painted).ok_or("EXPORT_FAILED")?;
        unsafe {
            let document: Option<Retained<AnyObject>> = msg_send![msg_send![class!(PDFDocument), alloc], initWithURL: &*source];
            let document = document.ok_or("EXPORT_FAILED")?;
            let delegate: Retained<PaperDelegate> = msg_send![PaperDelegate::alloc(), init];
            let _: () = msg_send![&*document, setDelegate: &*delegate];
            let pages: usize = msg_send![&*document, pageCount];
            if pages == 0 { return Err("EXPORT_FAILED".into()); }
            let written: bool = msg_send![&*document, writeToURL: &*target];
            let _: () = msg_send![&*document, setDelegate: Option::<&AnyObject>::None];
            if written { Ok(()) } else { Err("IO_ERROR".into()) }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    use std::path::{Path, PathBuf};
    use std::time::Duration;
    use tauri::AppHandle;
    pub enum Target { File(PathBuf), Panel(String) }
    pub struct Job { pub html: String, pub title: String, pub size: (f64, f64), pub target: Target }
    pub fn run(_app: &AppHandle, _job: Job, _timeout: Duration) -> Result<bool, String> { Err("UNSUPPORTED_PLATFORM".into()) }
    pub fn paint_paper(_printed: &Path, _painted: &Path, _color: [f64; 3]) -> Result<(), String> { Err("UNSUPPORTED_PLATFORM".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_sizes_and_colors_are_checked() {
        assert_eq!(paper_size("a4").unwrap(), (595.28, 841.89));
        assert_eq!(paper_size("letter").unwrap(), (612.0, 792.0));
        assert!(paper_size("a3").is_err());
        assert_eq!(paper_color("#ff0080").unwrap(), [1.0, 0.0, 128.0 / 255.0]);
        for bad in ["", "#fff", "ff0080", "#ff008g", "#ff00800", "red", "#ff0080;background:url(x)"] { assert!(paper_color(bad).is_err(), "{bad}"); }
    }

    #[test]
    fn the_suggested_name_is_one_pdf_file_name() {
        assert_eq!(suggested_name("读书笔记.md"), "读书笔记.pdf");
        assert_eq!(suggested_name("a/b:c\\d"), "abcd.pdf");
        assert_eq!(suggested_name("  ..hidden "), "hidden.pdf");
        assert_eq!(suggested_name(""), "Untitled.pdf");
        assert_eq!(suggested_name("x\ny"), "xy.pdf");
    }

    /// A page with a dark square and a link, painted with a paper color: the margin takes the paper, the
    /// square stays, and the link is still there.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_paper_goes_under_every_page_and_links_stay() {
        use objc2_core_foundation::{CFURL, CGPoint, CGRect, CGSize};
        use objc2_core_graphics::*;
        use objc2_foundation::NSURL;
        let work = WorkDir::new().unwrap();
        let printed = work.0.join("printed.pdf");
        let painted = work.0.join("painted.pdf");
        let cf = |path: &std::path::Path| NSURL::from_file_path(path).unwrap();
        let rect = |x: f64, y: f64, w: f64, h: f64| CGRect::new(CGPoint::new(x, y), CGSize::new(w, h));
        let media = rect(0.0, 0.0, 200.0, 300.0);
        let printed_url = cf(&printed);
        let link_url = NSURL::URLWithString(&objc2_foundation::NSString::from_str("https://example.com/")).unwrap();
        unsafe {
            let context = CGPDFContextCreateWithURL(Some(&*(&*printed_url as *const NSURL as *const CFURL)), &media, None).unwrap();
            for _ in 0..2 {
                CGContext::begin_page(Some(&context), &media);
                CGContext::set_rgb_fill_color(Some(&context), 0.1, 0.1, 0.1, 1.0);
                CGContext::fill_rect(Some(&context), rect(50.0, 100.0, 100.0, 100.0));
                CGPDFContextSetURLForRect(Some(&context), &*(&*link_url as *const NSURL as *const CFURL), rect(50.0, 100.0, 100.0, 100.0));
                CGContext::end_page(Some(&context));
            }
            CGPDFContextClose(Some(&context));
        }
        mac::paint_paper(&printed, &painted, paper_color("#f6efe0").unwrap()).unwrap();
        let bytes = fs::read(&painted).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
        assert!(String::from_utf8_lossy(&bytes).contains("example.com"), "the link annotation is kept");
        let painted_url = cf(&painted);
        let document = CGPDFDocument::with_url(Some(unsafe { &*(&*painted_url as *const NSURL as *const CFURL) })).unwrap();
        assert_eq!(CGPDFDocument::number_of_pages(Some(&document)), 2);
        for number in 1..=2 {
            let page = CGPDFDocument::page(Some(&document), number).unwrap();
            let (width, height) = (200usize, 300usize);
            let mut pixels = vec![0u8; width * height * 4];
            let space = CGColorSpace::new_device_rgb().unwrap();
            let bitmap = unsafe { CGBitmapContextCreate(pixels.as_mut_ptr().cast(), width, height, 8, width * 4, Some(&space), CGImageAlphaInfo::PremultipliedLast.0) }.unwrap();
            // Anything left unpainted shows as pure red.
            CGContext::set_rgb_fill_color(Some(&bitmap), 1.0, 0.0, 0.0, 1.0);
            CGContext::fill_rect(Some(&bitmap), media);
            CGContext::draw_pdf_page(Some(&bitmap), Some(&page));
            drop(bitmap);
            let at = |x: usize, y_from_top: usize| { let i = (y_from_top * width + x) * 4; [pixels[i], pixels[i + 1], pixels[i + 2]] };
            for corner in [at(2, 2), at(197, 297), at(100, 20)] { assert_eq!(corner, [0xf6, 0xef, 0xe0], "page {number}"); }
            let square = at(100, 150);
            assert!(square.iter().all(|&c| c < 40), "page {number}: {square:?}");
        }
    }

    #[test]
    fn oversized_pages_are_refused() {
        assert!(check_page("<html></html>").is_ok());
        assert_eq!(check_page(&"x".repeat(MAX_PAGE_BYTES + 1)), Err("EXPORT_TOO_LARGE".into()));
    }
}
