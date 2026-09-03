import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import SwiftRs
import UniformTypeIdentifiers
import Vision

// Window capture through ScreenCaptureKit: only the window's own pixels, no
// neighbours, works while covered or on another display, and it is the API
// macOS 15.1+ treats as legitimate (the legacy CGWindowList path triggers a
// "may be bypassing security settings" notice).
//
// Returns the PNG as base64, or an empty string when anything fails so the
// caller can fall back.
@_cdecl("_sck_capture_window_png_base64")
public func _sck_capture_window_png_base64(
  windowId: UInt32, maxLongSide: UInt32,
  sourceX: Int32, sourceY: Int32, sourceWidth: UInt32, sourceHeight: UInt32
) -> SRString {
  let semaphore = DispatchSemaphore(value: 0)
  var result = ""

  Task {
    defer { semaphore.signal() }
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: false)
      guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
        return
      }

      let filter = SCContentFilter(desktopIndependentWindow: window)
      let configuration = SCStreamConfiguration()
      // sourceRect is in points relative to the window's own origin.
      var sourceRect = CGRect(origin: .zero, size: window.frame.size)
      if sourceWidth > 0 && sourceHeight > 0 {
        let requested = CGRect(
          x: CGFloat(sourceX), y: CGFloat(sourceY),
          width: CGFloat(sourceWidth), height: CGFloat(sourceHeight))
        let clipped = requested.intersection(sourceRect)
        if clipped.width >= 1, clipped.height >= 1 {
          sourceRect = clipped
          configuration.sourceRect = clipped
        }
      }
      let scale = filter.pointPixelScale
      let pixelWidth = max(1.0, sourceRect.width * CGFloat(scale))
      let pixelHeight = max(1.0, sourceRect.height * CGFloat(scale))
      let longSide = max(pixelWidth, pixelHeight)
      let shrink =
        maxLongSide > 0 && longSide > CGFloat(maxLongSide)
        ? CGFloat(maxLongSide) / longSide : 1.0
      configuration.width = Int((pixelWidth * shrink).rounded())
      configuration.height = Int((pixelHeight * shrink).rounded())
      configuration.showsCursor = false
      configuration.captureResolution = .best

      let image = try await SCScreenshotManager.captureImage(
        contentFilter: filter, configuration: configuration)
      guard let png = encodePng(image) else { return }
      result = png.base64EncodedString()
    } catch {
      // Swallowed on purpose: the Rust side falls back to the legacy capture.
    }
  }

  _ = semaphore.wait(timeout: .now() + 10)
  return SRString(result)
}

// Text on the captured window, one recognised line per output line, top to
// bottom. Vision runs offline, so slide text reaches the summary even when the
// language model cannot see images.
@_cdecl("_vision_recognize_text")
public func _vision_recognize_text(png: SRData) -> SRString {
  let data = Data(png.toArray())
  guard let source = CGImageSourceCreateWithData(data as CFData, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    return SRString("")
  }

  let request = VNRecognizeTextRequest()
  // Accurate beats fast on slide typography by a wide margin at ~170 ms per
  // frame once the model is warm; fixed languages skip a costly detection pass.
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.automaticallyDetectsLanguage = false
  request.recognitionLanguages = ["de-DE", "en-US"]

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do {
    try handler.perform([request])
  } catch {
    return SRString("")
  }

  let lines = (request.results ?? [])
    .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
    .compactMap { $0.topCandidates(1).first?.string }
  return SRString(lines.joined(separator: "\n"))
}

private func encodePng(_ image: CGImage) -> Data? {
  let data = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      data as CFMutableData, UTType.png.identifier as CFString, 1, nil)
  else {
    return nil
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { return nil }
  return data as Data
}
