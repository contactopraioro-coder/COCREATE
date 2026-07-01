import AppKit
import ApplicationServices
import Foundation

struct TrackerPayload: Codable {
    let found: Bool
    let appName: String
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let isFrontmost: Bool
    let isMinimized: Bool
}

final class WindowTracker {
    private let appName: String
    private var runningApp: NSRunningApplication?
    private var appElement: AXUIElement?
    private var observer: AXObserver?
    private var observedWindow: AXUIElement?
    private var previousSignature = ""

    init(appName: String) {
        self.appName = appName
    }

    func start() {
        subscribeWorkspace()
        attachIfNeeded()
        emitCurrentState(force: true)

        Timer.scheduledTimer(withTimeInterval: 0.20, repeats: true) { [weak self] _ in
            self?.attachIfNeeded()
            self?.emitCurrentState(force: false)
        }

        RunLoop.current.run()
    }

    private func subscribeWorkspace() {
        let center = NSWorkspace.shared.notificationCenter
        let names: [NSNotification.Name] = [
            NSWorkspace.didActivateApplicationNotification,
            NSWorkspace.didDeactivateApplicationNotification,
            NSWorkspace.didHideApplicationNotification,
            NSWorkspace.didUnhideApplicationNotification,
            NSWorkspace.didLaunchApplicationNotification,
            NSWorkspace.didTerminateApplicationNotification
        ]

        for name in names {
            center.addObserver(
                forName: name,
                object: nil,
                queue: nil
            ) { [weak self] _ in
                self?.attachIfNeeded()
                self?.emitCurrentState(force: true)
            }
        }
    }

    private func attachIfNeeded() {
        let nextApp = NSWorkspace.shared.runningApplications.first {
            $0.localizedName == appName
        }

        guard let nextApp else {
            runningApp = nil
            appElement = nil
            observer = nil
            observedWindow = nil
            return
        }

        if runningApp?.processIdentifier == nextApp.processIdentifier, observer != nil {
            registerWindowNotificationsIfNeeded()
            return
        }

        runningApp = nextApp
        appElement = AXUIElementCreateApplication(nextApp.processIdentifier)
        observedWindow = nil

        var nextObserver: AXObserver?
        let refcon = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())

        let callback: AXObserverCallback = { _, _, _, refcon in
            guard let refcon else { return }
            let tracker = Unmanaged<WindowTracker>.fromOpaque(refcon).takeUnretainedValue()
            tracker.registerWindowNotificationsIfNeeded()
            tracker.emitCurrentState(force: true)
        }

        let result = AXObserverCreate(nextApp.processIdentifier, callback, &nextObserver)
        guard result == .success, let nextObserver else {
            observer = nil
            return
        }

        observer = nextObserver

        let notifications: [CFString] = [
            kAXMainWindowChangedNotification as CFString,
            kAXFocusedWindowChangedNotification as CFString,
            kAXApplicationActivatedNotification as CFString,
            kAXApplicationDeactivatedNotification as CFString
        ]

        for notification in notifications {
            AXObserverAddNotification(
                nextObserver,
                appElement!,
                notification,
                refcon
            )
        }

        CFRunLoopAddSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(nextObserver),
            .defaultMode
        )

        registerWindowNotificationsIfNeeded()
    }

    private func registerWindowNotificationsIfNeeded() {
        guard let appElement, let observer else { return }
        guard let nextWindow = copyWindowElement(from: appElement) else { return }

        if let observedWindow, CFEqual(observedWindow, nextWindow) {
            return
        }

        observedWindow = nextWindow
        let refcon = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        let notifications: [CFString] = [
            kAXMovedNotification as CFString,
            kAXResizedNotification as CFString,
            kAXWindowMiniaturizedNotification as CFString,
            kAXWindowDeminiaturizedNotification as CFString,
            kAXUIElementDestroyedNotification as CFString
        ]

        for notification in notifications {
            AXObserverAddNotification(observer, nextWindow, notification, refcon)
        }
    }

    private func emitCurrentState(force: Bool) {
        let payload = currentPayload()
        let signature = [
            payload.found ? "1" : "0",
            payload.x.map(String.init) ?? "-",
            payload.y.map(String.init) ?? "-",
            payload.width.map(String.init) ?? "-",
            payload.height.map(String.init) ?? "-",
            payload.isFrontmost ? "1" : "0",
            payload.isMinimized ? "1" : "0"
        ].joined(separator: ":")

        if force || signature != previousSignature {
          previousSignature = signature
          emit(payload)
        }
    }

    private func currentPayload() -> TrackerPayload {
        guard
            let app = runningApp,
            let appElement,
            let window = copyWindowElement(from: appElement),
            let position = copyCGPoint(from: window, attribute: kAXPositionAttribute as CFString),
            let size = copyCGSize(from: window, attribute: kAXSizeAttribute as CFString)
        else {
            return TrackerPayload(
                found: false,
                appName: appName,
                x: nil,
                y: nil,
                width: nil,
                height: nil,
                isFrontmost: false,
                isMinimized: false
            )
        }

        let minimized = copyBool(from: window, attribute: kAXMinimizedAttribute as CFString) ?? false

        return TrackerPayload(
            found: true,
            appName: appName,
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            isFrontmost: app.isActive,
            isMinimized: minimized
        )
    }

    private func copyWindowElement(from appElement: AXUIElement) -> AXUIElement? {
        if let window = copyElement(from: appElement, attribute: kAXFocusedWindowAttribute as CFString) {
            return window
        }
        return copyElement(from: appElement, attribute: kAXMainWindowAttribute as CFString)
    }

    private func copyElement(from element: AXUIElement, attribute: CFString) -> AXUIElement? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard result == .success, let value else { return nil }
        return (value as! AXUIElement)
    }

    private func copyBool(from element: AXUIElement, attribute: CFString) -> Bool? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard result == .success, let number = value as? NSNumber else { return nil }
        return number.boolValue
    }

    private func copyCGPoint(from element: AXUIElement, attribute: CFString) -> CGPoint? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard result == .success, let axValue = value else { return nil }
        guard CFGetTypeID(axValue) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        let cast = unsafeBitCast(axValue, to: AXValue.self)
        return AXValueGetValue(cast, .cgPoint, &point) ? point : nil
    }

    private func copyCGSize(from element: AXUIElement, attribute: CFString) -> CGSize? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard result == .success, let axValue = value else { return nil }
        guard CFGetTypeID(axValue) == AXValueGetTypeID() else { return nil }
        var size = CGSize.zero
        let cast = unsafeBitCast(axValue, to: AXValue.self)
        return AXValueGetValue(cast, .cgSize, &size) ? size : nil
    }

    private func emit(_ payload: TrackerPayload) {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(payload),
              let line = String(data: data, encoding: .utf8) else {
            return
        }
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
}

let name = CommandLine.arguments.dropFirst().first ?? "Codex"
let tracker = WindowTracker(appName: name)
tracker.start()
