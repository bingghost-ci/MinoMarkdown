// Renders reading-style samples from the UI preview in an off-screen WKWebView and tiles them into one PNG.
// It needs a Vite dev server (`npx vite`; pass its address with --url) and never touches the installed app.
//
//   swiftc -O scripts/style-samples.swift -o <dir>/style-samples
//   <dir>/style-samples --out sheet.png --styles light,paper,xuan [--settings '{"editorWidth":"centered"}']
//       [--sample reading|default] [--window 1280x860] [--cell 640] [--cols 3] [--scroll 0]
//       [--crop x,y,w,h] [--js "extra script run before each capture"] [--query "ui-settings-tab=appearance"]
//       [--url http://127.0.0.1:1430/] [--print]
//
// --print writes what the --js script stored in `window.sampleResult` for each style, for checks that read the page.
// The page records `window.sampleReadyAt` (ms after navigation start when the document appeared, polled every
// 20 ms or slower when WebKit throttles timers; at most 60 s) and `window.sampleFontsAt` for such scripts. --memory prints the resident size of the page's web process.
//
// --crop captures that rectangle at 1:1 (for paper textures); otherwise each window is scaled to --cell wide.
// Samples are review material for people; this tool does not judge them.
import AppKit
import WebKit

var options: [String: String] = [:]
var key: String?
for argument in CommandLine.arguments.dropFirst() {
  if argument.hasPrefix("--") { key = String(argument.dropFirst(2)); options[key!] = "" } else if let current = key { options[current] = argument; key = nil }
}
let outPath = options["out"] ?? ""
let styleList = options["styles"] ?? ""
if outPath.isEmpty || styleList.isEmpty { print("usage: style-samples --out <png> --styles <id,id> [options]"); exit(64) }
let styles = styleList.split(separator: ",").map(String.init)
let windowSize = (options["window"] ?? "1280x860").split(separator: "x").compactMap { Double($0) }
let (winW, winH) = (windowSize.first ?? 1280, windowSize.count > 1 ? windowSize[1] : 860)
let crop = options["crop"]?.split(separator: ",").compactMap { Double($0) }
let cellW = crop.map { $0[2] } ?? Double(options["cell"] ?? "640")!
let cellH = crop.map { $0[3] } ?? cellW * winH / winW
let cols = Int(options["cols"] ?? "3")!
let base = options["url"] ?? "http://127.0.0.1:1420/"
let sample = options["sample"] ?? "reading"
let settings = options["settings"] ?? "{}"
let scroll = Double(options["scroll"] ?? "0")!
let extra = options["js"] ?? ""

func url(for style: String) -> URL {
  var components = URLComponents(string: base)!
  components.queryItems = [URLQueryItem(name: "ui-preview", value: "editor"), URLQueryItem(name: "ui-theme", value: style), URLQueryItem(name: "ui-sample", value: sample), URLQueryItem(name: "ui-settings", value: settings)]
  // --query "ui-settings-tab=appearance&other=value" adds more preview parameters.
  for pair in (options["query"] ?? "").split(separator: "&") where pair.contains("=") {
    let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
    components.queryItems?.append(URLQueryItem(name: parts[0], value: parts[1]))
  }
  return components.url!
}

let prepare = #"""
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Off-screen pages throttle timers, so the wait is bounded by elapsed time rather than by a count.
for (const until = performance.now() + 60000; performance.now() < until && !document.querySelector('.ProseMirror, .markdown-preview-content, .cm-editor'); ) await wait(20);
window.sampleReadyAt = performance.now();
await document.fonts.ready;
window.sampleFontsAt = performance.now();
await wait(900);
await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)));
await document.fonts.ready;
document.querySelectorAll('.notice-bar').forEach((e) => e.remove());
if (extra) await (new Function('return (async () => {' + extra + '})()'))();
const scroller = document.querySelector('.editor-root:not([hidden])');
if (scroller && scroll) scroller.scrollTop = scroll;
await wait(400);
return window.sampleResult === undefined ? document.documentElement.dataset.theme : String(window.sampleResult);
"""#

/// Resident memory of a process, read with ps.
func residentKiB(_ pid: Int32) -> String {
  let ps = Process()
  ps.executableURL = URL(fileURLWithPath: "/bin/ps")
  ps.arguments = ["-o", "rss=", "-p", String(pid)]
  let pipe = Pipe()
  ps.standardOutput = pipe
  try? ps.run()
  ps.waitUntilExit()
  return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "?"
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: winW, height: winH), configuration: WKWebViewConfiguration())
let window = NSWindow(contentRect: NSRect(x: -8000, y: -8000, width: winW, height: winH), styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
window.orderBack(nil)

let labelHeight = 26.0
let rows = (styles.count + cols - 1) / cols
let sheet = NSImage(size: NSSize(width: cellW * Double(min(cols, styles.count)), height: (cellH + labelHeight) * Double(rows)))
var shots: [(String, NSImage)] = []
var index = 0

func finish() {
  sheet.lockFocus()
  NSColor(white: 0.93, alpha: 1).setFill(); NSRect(origin: .zero, size: sheet.size).fill()
  for (i, (name, image)) in shots.enumerated() {
    let col = i % cols, row = i / cols
    let y = sheet.size.height - Double(row + 1) * (cellH + labelHeight)
    image.draw(in: NSRect(x: Double(col) * cellW, y: y, width: cellW, height: cellH))
    (name as NSString).draw(at: NSPoint(x: Double(col) * cellW + 8, y: y + cellH + 5), withAttributes: [.font: NSFont.boldSystemFont(ofSize: 14), .foregroundColor: NSColor(white: 0.15, alpha: 1)])
  }
  sheet.unlockFocus()
  if let tiff = sheet.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
    try? png.write(to: URL(fileURLWithPath: outPath))
    print("wrote \(outPath)")
  }
  exit(0)
}

final class Driver: NSObject, WKNavigationDelegate {
  func next() {
    if index >= styles.count { finish(); return }
    web.load(URLRequest(url: url(for: styles[index])))
  }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.next() }
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    w.callAsyncJavaScript(prepare, arguments: ["extra": extra, "scroll": scroll], in: nil, in: .page) { result in
      if case .failure(let error) = result { print("JS ERROR", styles[index], error) }
      if options["print"] != nil, case .success(let value) = result { print("\(styles[index]): \(value)") }
      if options["memory"] != nil, let pid = w.value(forKey: "_webProcessIdentifier") as? Int32 { print("\(styles[index]): web process \(pid) rss \(residentKiB(pid)) KiB") }
      let config = WKSnapshotConfiguration()
      if let crop { config.rect = NSRect(x: crop[0], y: crop[1], width: crop[2], height: crop[3]); config.snapshotWidth = NSNumber(value: crop[2]) } else { config.snapshotWidth = NSNumber(value: cellW) }
      w.takeSnapshot(with: config) { image, _ in
        if let image { shots.append((styles[index], image)) }
        index += 1
        self.next()
      }
    }
  }
}

let driver = Driver()
web.navigationDelegate = driver
driver.next()
DispatchQueue.main.asyncAfter(deadline: .now() + 600) { print("TIMEOUT"); exit(2) }
app.run()
