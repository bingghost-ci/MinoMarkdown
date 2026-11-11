// Prints exported HTML pages to PDF through WKWebView and NSPrintOperation (no dialogs), the same engine the
// app's print command uses, and saves a PNG of the first pages next to each PDF for review.
//
//   swiftc -O scripts/html-to-pdf.swift -o <dir>/html-to-pdf
//   <dir>/html-to-pdf <page.html> [<page.html> …]      # writes <page>.pdf and <page>.png
//
// Page size and margins come from the page's own @page rule; the print info adds no margin.
import AppKit
import PDFKit
import WebKit

let inputs = CommandLine.arguments.dropFirst().map { URL(fileURLWithPath: $0) }
if inputs.isEmpty { print("usage: html-to-pdf <page.html> …"); exit(64) }

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let window = NSWindow(contentRect: NSRect(x: -8000, y: -8000, width: 800, height: 1000), styleMask: [.borderless], backing: .buffered, defer: false)
var index = 0

func preview(_ pdf: URL) {
  guard let document = PDFDocument(url: pdf) else { return }
  let count = min(document.pageCount, 2)
  let scale = 1.5
  let size = document.page(at: 0)!.bounds(for: .mediaBox).size
  let sheet = NSImage(size: NSSize(width: size.width * scale * Double(count) + 16 * Double(count - 1), height: size.height * scale))
  sheet.lockFocus()
  NSColor(white: 0.85, alpha: 1).setFill(); NSRect(origin: .zero, size: sheet.size).fill()
  for i in 0..<count {
    let thumb = document.page(at: i)!.thumbnail(of: NSSize(width: size.width * scale, height: size.height * scale), for: .mediaBox)
    thumb.draw(in: NSRect(x: Double(i) * (size.width * scale + 16), y: 0, width: size.width * scale, height: size.height * scale))
  }
  sheet.unlockFocus()
  if let tiff = sheet.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
    try? png.write(to: pdf.deletingPathExtension().appendingPathExtension("png"))
  }
  print("\(pdf.lastPathComponent): \(document.pageCount) pages")
}

final class Driver: NSObject, WKNavigationDelegate {
  var web: WKWebView!
  func next() {
    if index >= inputs.count { exit(0) }
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 1000), configuration: WKWebViewConfiguration())
    web.navigationDelegate = self
    window.contentView = web
    window.orderBack(nil)
    web.loadFileURL(inputs[index], allowingReadAccessTo: inputs[index].deletingLastPathComponent())
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.evaluateJavaScript("document.fonts.ready.then(() => document.fonts.size)") { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.printPage(webView) }
    }
  }
  func printPage(_ webView: WKWebView) {
    let url = inputs[index].deletingPathExtension().appendingPathExtension("pdf")
    try? FileManager.default.removeItem(at: url)
    let info = NSPrintInfo(dictionary: [.jobDisposition: NSPrintInfo.JobDisposition.save, .jobSavingURL: url])
    info.paperSize = NSSize(width: 595.28, height: 841.89)
    info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0
    let op = webView.printOperation(with: info)
    op.showsPrintPanel = false
    op.showsProgressPanel = false
    op.view?.frame = webView.bounds
    op.runModal(for: window, delegate: self, didRun: #selector(printed(_:success:contextInfo:)), contextInfo: nil)
  }
  @objc func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    preview(inputs[index].deletingPathExtension().appendingPathExtension("pdf"))
    index += 1
    DispatchQueue.main.async { self.next() }
  }
}

let driver = Driver()
driver.next()
DispatchQueue.main.asyncAfter(deadline: .now() + 300) { print("TIMEOUT"); exit(2) }
app.run()
