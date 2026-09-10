// KanclBar — realtime widget Kanclu v menu baru macOS.
// Jediný soubor, bez Xcode: `bash bar/build.sh` ho přeloží přes swiftc do bar/build/KanclBar.app.
// Každé 3 s čte http://127.0.0.1:4242/api/widget a ukazuje: kdo chce tebe, noční směnu, CI.
// Klik na sezení = stejný fokus jako Enter v Kanclu. `KanclBar --once` vypíše stav do terminálu a skončí.

import AppKit
import Foundation
import WebKit

struct WQueue: Decodable { let id: String; let name: String; let nick: String?; let status: String; let since: Double; let project: String?; let message: String? }
struct WNight: Decodable { let ok: Int; let fail: Int; let running: Int; let sleeping: Int; let snapshotAt: Double?; let snapshotOld: Bool; let nextName: String?; let nextAt: Double? }
struct WCi: Decodable { let project: String; let name: String?; let url: String? }
struct WStock: Decodable { let project: String; let pending: Int; let alarm: Bool }
struct WSessions: Decodable { let total: Int; let working: Int; let attention: Int }
struct WProject: Decodable { let name: String; let sessions: Int }
struct Widget: Decodable {
  let at: Double
  let sessions: WSessions
  let queue: [WQueue]
  let working: [WProject]
  let night: WNight
  let ci: [WCi]
  let stock: [WStock]
}

let base = ProcessInfo.processInfo.environment["KANCL_URL"] ?? "http://127.0.0.1:4242"
let STATUS_LABEL: [String: String] = ["permission": "dotaz", "error": "chyba", "waiting": "čeká", "completed": "hotovo"]
let STATUS_ICON: [String: String] = ["permission": "❓", "error": "‼️", "waiting": "💬", "completed": "✅"]

func ago(_ ms: Double) -> String {
  let s = max(0, Int((Date().timeIntervalSince1970 * 1000 - ms) / 1000))
  if s < 60 { return "\(s) s" }
  let m = s / 60
  if m < 60 { return "\(m) min" }
  return "\(m / 60) h \(m % 60) min"
}

func clock(_ ms: Double) -> String {
  let f = DateFormatter(); f.dateFormat = "HH:mm"
  return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

func fetchWidget(_ done: @escaping (Widget?) -> Void) {
  guard let url = URL(string: base + "/api/widget") else { done(nil); return }
  var req = URLRequest(url: url); req.timeoutInterval = 2
  URLSession.shared.dataTask(with: req) { data, _, err in
    guard let data, err == nil, let w = try? JSONDecoder().decode(Widget.self, from: data) else { done(nil); return }
    done(w)
  }.resume()
}

/// Titulek v menu baru: ikona + jen to, co hoří. V klidu „🕹 pracuje/celkem".
func barTitle(_ w: Widget) -> String {
  // co nejkratší: v menu baru je málo místa. Detaily jsou v panelu a v menu.
  var parts: [String] = []
  let count = { (st: String) in w.queue.filter { $0.status == st }.count }
  for st in ["permission", "error", "waiting"] { let n = count(st); if n > 0 { parts.append("\(STATUS_ICON[st]!)\(n)") } }
  if w.night.fail > 0 || !w.ci.isEmpty || w.stock.contains(where: { $0.alarm }) { parts.append("⚠︎") }
  return parts.isEmpty ? "🕹" : "🕹" + parts.joined(separator: "")
}

/// Řádky menu jako text (stejné pro --once i pro NSMenu).
func lines(_ w: Widget) -> [(text: String, kind: String, ref: String?)] {
  var out: [(String, String, String?)] = []
  out.append(("Kancl · \(w.sessions.total) sezení · \(w.sessions.working) pracuje", "head", nil))
  if w.queue.isEmpty { out.append(("nikdo tě nepotřebuje", "muted", nil)) }
  for q in w.queue.prefix(8) {
    let nick = q.nick.map { " · \($0)" } ?? ""
    out.append(("\(STATUS_ICON[q.status] ?? "•") \(q.name)\(nick) · \(STATUS_LABEL[q.status] ?? q.status) \(ago(q.since))", "session", q.id))
    if let m = q.message, !m.isEmpty { out.append(("      \(m.prefix(70))", "muted", nil)) }
  }
  if !w.working.isEmpty { out.append(("v práci: " + w.working.map { "\($0.name) (\($0.sessions))" }.joined(separator: ", "), "muted", nil)) }
  out.append(("—", "sep", nil))
  var night = "🌙 noční směna: \(w.night.ok) ✓"
  if w.night.fail > 0 { night += " · \(w.night.fail) ✗" }
  if w.night.running > 0 { night += " · \(w.night.running) běží" }
  if let n = w.night.nextName, let at = w.night.nextAt { night += " · další \(n) \(clock(at))" }
  out.append((night, "night", nil))
  if w.night.snapshotOld { out.append(("cloud: snímek je starý, aplikace Claude asi neběží", "warn", nil)) }
  for c in w.ci { out.append(("CI ✗ \(c.project) · \(c.name ?? "workflow")", "ci", c.url)) }
  if !w.stock.isEmpty {
    let s = w.stock.map { "\($0.project) \($0.pending)\($0.alarm ? "!" : "")" }.joined(separator: " · ")
    out.append(("📚 zásoba témat: \(s)", w.stock.contains { $0.alarm } ? "warn" : "muted", nil))
  }
  return out
}

/// Lišta nahoře na panelu: táhne se za ni, má sbalení (–) a schování (×).
final class GrabBar: NSView {
  let label = NSTextField(labelWithString: "Kancl")
  let collapseBtn = NSButton(title: "–", target: nil, action: nil)
  let closeBtn = NSButton(title: "×", target: nil, action: nil)
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.09, green: 0.11, blue: 0.14, alpha: 1).cgColor
    label.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold)
    label.textColor = NSColor(calibratedRed: 0.9, green: 0.91, blue: 0.94, alpha: 1)
    label.lineBreakMode = .byTruncatingTail
    for b in [collapseBtn, closeBtn] {
      b.isBordered = false; b.font = NSFont.systemFont(ofSize: 12, weight: .bold)
      b.contentTintColor = NSColor(calibratedWhite: 0.7, alpha: 1)
    }
    addSubview(label); addSubview(collapseBtn); addSubview(closeBtn)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func layout() {
    super.layout()
    closeBtn.frame = NSRect(x: bounds.width - 22, y: 0, width: 20, height: bounds.height)
    collapseBtn.frame = NSRect(x: bounds.width - 44, y: 0, width: 20, height: bounds.height)
    label.frame = NSRect(x: 10, y: 3, width: bounds.width - 58, height: bounds.height - 6)
  }
  override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}

/// Plovoucí panel u okraje obrazovky s živým mini režimem (?mini=1). Vždy nahoře, na všech plochách.
final class SidePanel {
  let panel: NSPanel
  let web: WKWebView
  let grab = GrabBar(frame: .zero)
  let grabH: CGFloat = 24
  var expandedHeight: CGFloat = 320
  var collapsed = UserDefaults.standard.bool(forKey: "panelCollapsed")

  init() {
    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let w: CGFloat = 340, h: CGFloat = 320
    let frame = NSRect(x: screen.maxX - w - 12, y: screen.maxY - h - 12, width: w, height: h)
    panel = NSPanel(contentRect: frame, styleMask: [.borderless, .resizable, .utilityWindow, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isMovableByWindowBackground = false
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.hasShadow = true
    panel.isOpaque = false
    panel.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.07, blue: 0.09, alpha: 1)
    panel.minSize = NSSize(width: 220, height: grabH)
    panel.alphaValue = CGFloat(UserDefaults.standard.object(forKey: "panelAlpha") as? Double ?? 1.0)
    panel.setFrameAutosaveName("KanclPanel")
    let content = NSView(frame: panel.contentView!.bounds)
    content.wantsLayer = true
    content.layer?.cornerRadius = 10
    content.layer?.masksToBounds = true
    panel.contentView = content
    web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    web.setValue(false, forKey: "drawsBackground")
    content.addSubview(web)
    content.addSubview(grab)
    grab.collapseBtn.target = self; grab.collapseBtn.action = #selector(toggleCollapse)
    grab.closeBtn.target = self; grab.closeBtn.action = #selector(hideFromButton)
    if let url = URL(string: base + "/?mini=1") { web.load(URLRequest(url: url)) }
    expandedHeight = max(panel.frame.height, 120)
    if collapsed { applyCollapsed(animate: false) }
    NotificationCenter.default.addObserver(forName: NSWindow.didResizeNotification, object: panel, queue: .main) { [weak self] _ in self?.relayout() }
    relayout()
  }

  func relayout() {
    let b = panel.contentView!.bounds
    grab.frame = NSRect(x: 0, y: b.height - grabH, width: b.width, height: grabH)
    web.frame = NSRect(x: 0, y: 0, width: b.width, height: max(0, b.height - grabH))
    web.isHidden = collapsed
    grab.collapseBtn.title = collapsed ? "+" : "–"
    if !collapsed && panel.frame.height > grabH + 10 { expandedHeight = panel.frame.height }
  }

  func setTitle(_ t: String) { grab.label.stringValue = t }

  func applyCollapsed(animate: Bool) {
    var f = panel.frame
    let top = f.maxY
    f.size.height = collapsed ? grabH : expandedHeight
    f.origin.y = top - f.size.height
    panel.setFrame(f, display: true, animate: animate)
    relayout()
  }

  @objc func toggleCollapse() {
    if !collapsed { expandedHeight = panel.frame.height }
    collapsed.toggle()
    UserDefaults.standard.set(collapsed, forKey: "panelCollapsed")
    applyCollapsed(animate: true)
  }
  @objc func hideFromButton() { hide(); UserDefaults.standard.set(false, forKey: "panelVisible") }

  func snap(_ corner: String) {
    let s = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    var f = panel.frame
    let m: CGFloat = 12
    f.origin.x = corner.hasSuffix("L") ? s.minX + m : s.maxX - f.width - m
    f.origin.y = corner.hasPrefix("T") ? s.maxY - f.height - m : s.minY + m
    panel.setFrame(f, display: true, animate: true)
  }
  func setAlpha(_ a: Double) { panel.alphaValue = CGFloat(a); UserDefaults.standard.set(a, forKey: "panelAlpha") }

  var isVisible: Bool { panel.isVisible }
  func show() { panel.orderFrontRegardless(); relayout() }
  func hide() { panel.orderOut(nil) }
  func reload() { web.reload() }
}

final class Bar: NSObject {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  let menu = NSMenu()
  var timer: Timer?
  var last: Widget?
  var side: SidePanel?

  func start() {
    item.autosaveName = "KanclBar"
    item.button?.title = "🕹"
    item.menu = menu
    if UserDefaults.standard.object(forKey: "panelVisible") as? Bool ?? true { showPanel() }
    refresh()
    timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
  }

  func refresh() {
    fetchWidget { w in DispatchQueue.main.async { self.render(w) } }
  }

  func render(_ w: Widget?) {
    menu.removeAllItems()
    guard let w else {
      item.button?.title = "🕹✕"
      side?.setTitle("Kancl neběží")
      menu.addItem(withTitle: "Kancl neběží (\(base))", action: nil, keyEquivalent: "")
      addFooter()
      return
    }
    last = w
    item.button?.title = barTitle(w)
    side?.setTitle("Kancl · \(w.sessions.working)/\(w.sessions.total) pracuje" + (w.queue.isEmpty ? "" : " · \(w.queue.count) chce tě") + (w.night.fail > 0 ? " · 🌙✗\(w.night.fail)" : "") + (w.ci.isEmpty ? "" : " · CI✗\(w.ci.count)"))
    item.button?.toolTip = "Kancl · \(w.sessions.attention) chce tě"
    for l in lines(w) {
      if l.kind == "sep" { menu.addItem(.separator()); continue }
      let mi = NSMenuItem(title: l.text, action: nil, keyEquivalent: "")
      switch l.kind {
      case "session":
        mi.action = #selector(focus(_:)); mi.target = self; mi.representedObject = l.ref
      case "ci":
        if let u = l.ref { mi.action = #selector(openUrl(_:)); mi.target = self; mi.representedObject = u }
      case "head":
        mi.attributedTitle = NSAttributedString(string: l.text, attributes: [.font: NSFont.boldSystemFont(ofSize: 13)])
      case "muted":
        mi.attributedTitle = NSAttributedString(string: l.text, attributes: [.foregroundColor: NSColor.secondaryLabelColor, .font: NSFont.systemFont(ofSize: 12)])
      case "warn":
        mi.attributedTitle = NSAttributedString(string: l.text, attributes: [.foregroundColor: NSColor.systemOrange, .font: NSFont.systemFont(ofSize: 12)])
      default: break
      }
      menu.addItem(mi)
    }
    addFooter()
  }

  func showPanel() { if side == nil { side = SidePanel() }; side?.show(); UserDefaults.standard.set(true, forKey: "panelVisible") }
  func hidePanel() { side?.hide(); UserDefaults.standard.set(false, forKey: "panelVisible") }
  @objc func togglePanel() { if side?.isVisible == true { hidePanel() } else { showPanel() } }
  @objc func reloadPanel() { side?.reload() }
  @objc func collapsePanel() { side?.toggleCollapse() }
  @objc func snapPanel(_ sender: NSMenuItem) { if let k = sender.representedObject as? String { side?.snap(k) } }
  @objc func alphaPanel(_ sender: NSMenuItem) { if let v = sender.representedObject as? Double { side?.setAlpha(v) } }

  func addFooter() {
    menu.addItem(.separator())
    let p = NSMenuItem(title: "Panel u okraje obrazovky", action: #selector(togglePanel), keyEquivalent: "p"); p.target = self; p.state = side?.isVisible == true ? .on : .off; menu.addItem(p)
    if side?.isVisible == true {
      let c = NSMenuItem(title: side?.collapsed == true ? "Rozbalit panel" : "Sbalit panel na proužek", action: #selector(collapsePanel), keyEquivalent: "c"); c.target = self; menu.addItem(c)
      let pos = NSMenuItem(title: "Přesunout do rohu", action: nil, keyEquivalent: ""); let sub = NSMenu()
      for (t, k) in [("vpravo nahoře", "TR"), ("vpravo dole", "BR"), ("vlevo nahoře", "TL"), ("vlevo dole", "BL")] { let i = NSMenuItem(title: t, action: #selector(snapPanel(_:)), keyEquivalent: ""); i.target = self; i.representedObject = k; sub.addItem(i) }
      pos.submenu = sub; menu.addItem(pos)
      let al = NSMenuItem(title: "Průhlednost", action: nil, keyEquivalent: ""); let asub = NSMenu()
      for (t, v) in [("plná", 1.0), ("85 %", 0.85), ("70 %", 0.7), ("55 %", 0.55)] { let i = NSMenuItem(title: t, action: #selector(alphaPanel(_:)), keyEquivalent: ""); i.target = self; i.representedObject = v; if abs((side?.panel.alphaValue ?? 1) - v) < 0.01 { i.state = .on }; asub.addItem(i) }
      al.submenu = asub; menu.addItem(al)
      let r = NSMenuItem(title: "Obnovit panel", action: #selector(reloadPanel), keyEquivalent: ""); r.target = self; menu.addItem(r)
    }
    let open = NSMenuItem(title: "Otevřít Kancl", action: #selector(openKancl), keyEquivalent: "o"); open.target = self; menu.addItem(open)
    let mini = NSMenuItem(title: "Mini režim", action: #selector(openMini), keyEquivalent: "m"); mini.target = self; menu.addItem(mini)
    let dig = NSMenuItem(title: "Co se stalo (ráno)", action: #selector(openDigest), keyEquivalent: "r"); dig.target = self; menu.addItem(dig)
    let q = NSMenuItem(title: "Ukončit KanclBar", action: #selector(quit), keyEquivalent: "q"); q.target = self; menu.addItem(q)
  }

  @objc func focus(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String,
          let enc = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
          let url = URL(string: "\(base)/api/sessions/\(enc)/focus") else { return }
    var req = URLRequest(url: url); req.httpMethod = "POST"
    URLSession.shared.dataTask(with: req).resume()
    if let s = last?.queue.first(where: { $0.id == id }) {
      NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s.name, forType: .string)
    }
  }
  @objc func openUrl(_ sender: NSMenuItem) { if let u = sender.representedObject as? String, let url = URL(string: u) { NSWorkspace.shared.open(url) } }
  @objc func openKancl() { NSWorkspace.shared.open(URL(string: base)!) }
  @objc func openMini() { NSWorkspace.shared.open(URL(string: base + "/?mini=1")!) }
  @objc func openDigest() { NSWorkspace.shared.open(URL(string: base + "/?digest=1")!) }
  @objc func quit() { NSApp.terminate(nil) }
}

// ---- vstup -----------------------------------------------------------------
if CommandLine.arguments.contains("--once") {
  let sem = DispatchSemaphore(value: 0)
  fetchWidget { w in
    if let w {
      print(barTitle(w))
      for l in lines(w) { print(l.kind == "sep" ? "---" : l.text) }
    } else { print("Kancl neběží (\(base))") }
    sem.signal()
  }
  sem.wait()
  exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let bar = Bar()
bar.start()
app.run()
