// T52: checks how WKWebView prints a styled page to PDF on this Mac, without any dialog.
//
// Usage: swiftc -O scripts/print-pdf-probe.swift -o <dir>/print-pdf-probe && <dir>/print-pdf-probe <out-dir> [font.woff2]
//
// Each variant prints the same long page with a paper background to <out-dir>/<variant>.pdf through
// NSPrintOperation (save disposition, no print or progress panel), then rasterizes the first two pages
// and reports the corner color, where the text starts on page 2, and whether a font file is embedded.
import AppKit
import PDFKit
import WebKit

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let fontPath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

struct Variant { let name: String; let printBackgrounds: Bool; let pageMarginMM: Double; let infoMarginPt: Double; let css: String }
let paper = "#f7f1e3"
let variants: [Variant] = [
  Variant(name: "A-default", printBackgrounds: false, pageMarginMM: 18, infoMarginPt: 0, css: ""),
  Variant(name: "B-prefs-on", printBackgrounds: true, pageMarginMM: 18, infoMarginPt: 0, css: ""),
  Variant(name: "C-color-adjust", printBackgrounds: false, pageMarginMM: 18, infoMarginPt: 0, css: "html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }"),
  Variant(name: "D-prefs-on-margin0", printBackgrounds: true, pageMarginMM: 0, infoMarginPt: 0, css: "article { padding: 0 18mm; }"),
  Variant(name: "E-color-adjust-margin0", printBackgrounds: false, pageMarginMM: 0, infoMarginPt: 0, css: "html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } article { padding: 0 18mm; }"),
  Variant(name: "F-page-background", printBackgrounds: true, pageMarginMM: 18, infoMarginPt: 0, css: "@page { background: #f7f1e3; }"),
  Variant(name: "H-decoration-clone", printBackgrounds: false, pageMarginMM: 0, infoMarginPt: 0, css: "html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } article { padding: 18mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }"),
  Variant(name: "I-table-rows", printBackgrounds: false, pageMarginMM: 0, infoMarginPt: 0, css: "html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } table.sheet { width: 100%; border-collapse: collapse; } table.sheet > thead { display: table-header-group; } table.sheet > tfoot { display: table-footer-group; } .spacer { height: 18mm; } table.sheet td { padding: 0 18mm; } tr { break-inside: avoid; }"),
  Variant(name: "G-table-spacers", printBackgrounds: true, pageMarginMM: 0, infoMarginPt: 0, css: "table.sheet { width: 100%; border-collapse: collapse; } table.sheet > thead { display: table-header-group; } table.sheet > tfoot { display: table-footer-group; } .spacer { height: 18mm; } table.sheet td { padding: 0 18mm; }"),
]

func page(_ v: Variant) -> String {
  var face = ""
  var family = "'Songti SC', serif"
  if let fontPath, let data = FileManager.default.contents(atPath: fontPath) {
    face = "@font-face { font-family: 'ProbeFont'; src: url(data:font/woff2;base64,\(data.base64EncodedString())) format('woff2'); font-display: block; }"
    family = "'ProbeFont', 'Songti SC', serif"
  }
  let margin = v.pageMarginMM >= 0 ? "@page { size: A4; margin: \(v.pageMarginMM)mm; }" : "@page { size: A4; }"
  let paragraph = "阅读体验验证：纸张底色应当铺满整页，跨页时上下边距保持一致。The quick brown fox jumps over the lazy dog, 1234567890。"
  let body = (1...90).map { "<p>\($0). \(paragraph)\(paragraph)</p>" }.joined()
  let rows = (1...90).map { "<tr><td><p>\($0). \(paragraph)\(paragraph)</p></td></tr>" }.joined()
  if v.name.contains("rows") { return "<!doctype html><html><head><meta charset=utf-8><style>\(face) \(margin) html { background: \(paper); } body { margin: 0; color: #2e261d; font: 15px/1.8 \(family); } \(v.css)</style></head><body><table class=sheet><thead><tr><td><div class=spacer></div></td></tr></thead><tfoot><tr><td><div class=spacer></div></td></tr></tfoot><tbody>\(rows)</tbody></table></body></html>" }
  let content = v.name.contains("table") ? "<table class=sheet><thead><tr><td><div class=spacer></div></td></tr></thead><tfoot><tr><td><div class=spacer></div></td></tr></tfoot><tbody><tr><td><article>\(body)</article></td></tr></tbody></table>" : "<article>\(body)</article>"
  return "<!doctype html><html><head><meta charset=utf-8><style>\(face) \(margin) html { background: \(paper); } body { margin: 0; color: #2e261d; font: 15px/1.8 \(family); } \(v.css)</style></head><body>\(content)</body></html>"
}

final class Runner: NSObject, WKNavigationDelegate {
  var index = 0
  var web: WKWebView!
  let window = NSWindow(contentRect: NSRect(x: -6000, y: -6000, width: 800, height: 1000), styleMask: [.borderless], backing: .buffered, defer: false)
  var results: [String] = []

  func next() {
    if index >= variants.count {
      let summary = results.joined(separator: "\n")
      print(summary)
      try? summary.write(to: outDir.appendingPathComponent("print-pdf-probe.txt"), atomically: true, encoding: .utf8)
      exit(0)
    }
    let v = variants[index]
    let config = WKWebViewConfiguration()
    if #available(macOS 13.3, *) { config.preferences.shouldPrintBackgrounds = v.printBackgrounds }
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 1000), configuration: config)
    web.navigationDelegate = self
    window.contentView = web
    window.orderBack(nil)
    web.loadHTMLString(page(v), baseURL: nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.evaluateJavaScript("document.fonts.ready.then(() => document.fonts.size)") { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.printPage(webView) }
    }
  }

  func printPage(_ webView: WKWebView) {
    let v = variants[index]
    let url = outDir.appendingPathComponent("\(v.name).pdf")
    try? FileManager.default.removeItem(at: url)
    let info = NSPrintInfo(dictionary: [.jobDisposition: NSPrintInfo.JobDisposition.save, .jobSavingURL: url])
    info.paperSize = NSSize(width: 595.28, height: 841.89)
    info.topMargin = v.infoMarginPt; info.bottomMargin = v.infoMarginPt; info.leftMargin = v.infoMarginPt; info.rightMargin = v.infoMarginPt
    info.horizontalPagination = .automatic
    info.verticalPagination = .automatic
    let op = webView.printOperation(with: info)
    op.showsPrintPanel = false
    op.showsProgressPanel = false
    op.view?.frame = webView.bounds
    op.runModal(for: window, delegate: self, didRun: #selector(printed(_:success:contextInfo:)), contextInfo: nil)
  }

  @objc func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    let v = variants[index]
    let url = outDir.appendingPathComponent("\(v.name).pdf")
    results.append("\(v.name) printBackgrounds=\(v.printBackgrounds) pageMargin=\(v.pageMarginMM)mm infoMargin=\(v.infoMarginPt)pt success=\(success) " + analyze(url))
    index += 1
    DispatchQueue.main.async { self.next() }
  }
}

func hex(_ c: NSColor?) -> String {
  guard let c = c?.usingColorSpace(.sRGB) else { return "none" }
  return String(format: "#%02x%02x%02x", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)), Int(round(c.blueComponent * 255)))
}

/// Rasterizes a page at 1 pt per pixel over white, so unpainted areas read as #ffffff.
func raster(_ page: PDFPage) -> NSBitmapImageRep {
  let box = page.bounds(for: .mediaBox)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(box.width), pixelsHigh: Int(box.height), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let context = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = context
  NSColor.white.setFill(); NSRect(x: 0, y: 0, width: box.width, height: box.height).fill()
  page.draw(with: .mediaBox, to: context.cgContext)
  NSGraphicsContext.restoreGraphicsState()
  return rep
}

/// First and last pixel rows (from the top) that contain text-dark pixels.
func textRows(_ rep: NSBitmapImageRep) -> (Int, Int)? {
  var first: Int?, last: Int?
  for y in 0..<rep.pixelsHigh {
    for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
      if let c = rep.colorAt(x: x, y: y), c.brightnessComponent < 0.45 { if first == nil { first = y }; last = y; break }
    }
  }
  if let first, let last { return (first, last) }
  return nil
}

func analyze(_ url: URL) -> String {
  guard let doc = PDFDocument(url: url), doc.pageCount > 0 else { return "pdf=missing" }
  let mm = 25.4 / 72
  var parts = ["pages=\(doc.pageCount)"]
  for index in 0..<min(2, doc.pageCount) {
    let rep = raster(doc.page(at: index)!)
    let corner = hex(rep.colorAt(x: 3, y: 3)), centre = hex(rep.colorAt(x: rep.pixelsWide / 2, y: 6))
    var text = "none"
    if let (top, bottom) = textRows(rep) { text = String(format: "top=%.1fmm bottom=%.1fmm", Double(top) * mm, Double(rep.pixelsHigh - 1 - bottom) * mm) }
    var paperPixels = 0, total = 0
    for y in stride(from: 0, to: rep.pixelsHigh, by: 3) { for x in stride(from: 0, to: rep.pixelsWide, by: 3) {
      total += 1
      if let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB), abs(c.redComponent * 255 - 247) < 3, abs(c.greenComponent * 255 - 241) < 3, abs(c.blueComponent * 255 - 227) < 3 { paperPixels += 1 }
    } }
    parts.append("p\(index + 1)[corner=\(corner) topEdge=\(centre) \(text) paper=\(Int(Double(paperPixels) / Double(total) * 100))%]")
  }
  let bytes = (try? Data(contentsOf: url)) ?? Data()
  let latin = String(decoding: bytes, as: UTF8.self)
  let embedded = ["/FontFile2", "/FontFile3", "/FontFile"].contains { latin.contains($0) }
  let regex = try! NSRegularExpression(pattern: "/BaseFont\\s*/([A-Za-z0-9+_-]+)")
  let found = regex.matches(in: latin, range: NSRange(latin.startIndex..., in: latin)).compactMap { Range($0.range(at: 1), in: latin).map { String(latin[$0]) } }
  let names = Set(found).sorted().prefix(6).joined(separator: ",")
  parts.append("fontEmbedded=\(embedded) fonts=\(names) bytes=\(bytes.count)")
  return parts.joined(separator: " ")
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let runner = Runner()
runner.next()
DispatchQueue.main.asyncAfter(deadline: .now() + 180) { print("TIMEOUT"); exit(2) }
app.run()
